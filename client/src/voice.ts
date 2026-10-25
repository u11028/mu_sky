// Team voice chat. Each teammate with their microphone on gets a direct audio link (WebRTC) to every
// other one; the game server only passes on the few messages that set a link up.
//
// Who to link with comes from the team status the server sends every second: teammates who are
// online with their microphone on. Of each pair, the one with the smaller voice tag makes the offer.

export interface VoiceMate {
  voice: string;
  talking: boolean;
  online: boolean;
  me: boolean;
}

type Signal = { offer: RTCSessionDescriptionInit } | { answer: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit };

interface Link {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** How loud they are now, for the "speaking" light. */
  level?: AnalyserNode;
}

// Public STUN servers let two phones behind home routers find a way to each other.
const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
/** Loudness (0 to 1) above which someone counts as speaking. */
const SPEAKING = 0.04;

export class Voice {
  private microphone?: MediaStream;
  private links = new Map<string, Link>();
  private myTag = "";
  private audioContext?: AudioContext;
  private meter?: AnalyserNode;

  constructor(
    private readonly send: (type: string, message: unknown) => void,
    /** Called a few times a second with who is speaking (voice tags; "me" for the local player). */
    private readonly onSpeaking: (speaking: Set<string>) => void,
  ) {
    setInterval(() => this.measure(), 200);
  }

  get on() {
    return this.microphone !== undefined;
  }

  /** Turns the microphone on (asking the browser's permission the first time). */
  async start() {
    if (this.microphone) {
      return;
    }
    this.microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.audioContext ??= new AudioContext();
    void this.audioContext.resume();
    this.meter = this.analyse(this.microphone);
    this.send("voice", { on: true });
  }

  stop() {
    this.send("voice", { on: false });
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.microphone = undefined;
    this.meter = undefined;
    for (const tag of [...this.links.keys()]) {
      this.close(tag);
    }
    this.onSpeaking(new Set());
  }

  /** The server lost track of us (a new connection after travelling or reconnecting): say again that we talk. */
  announce() {
    if (this.microphone) {
      this.send("voice", { on: true });
    }
  }

  /** The team as it is now: links to teammates who talk, none to anyone else. */
  syncTeam(mates: VoiceMate[]) {
    const me = mates.find((mate) => mate.me);
    if (me) {
      this.myTag = me.voice;
    }
    const wanted = new Set(
      this.microphone ? mates.filter((mate) => !mate.me && mate.online && mate.talking).map((mate) => mate.voice) : [],
    );
    for (const tag of [...this.links.keys()]) {
      if (!wanted.has(tag)) {
        this.close(tag);
      }
    }
    for (const tag of wanted) {
      if (!this.links.has(tag) && this.myTag && this.myTag < tag) {
        void this.call(tag);
      }
    }
  }

  async receive(from: string, data: Signal) {
    if (!this.microphone) {
      return;
    }
    if ("offer" in data) {
      // A teammate calls: answer on a fresh link.
      this.close(from);
      const link = this.open(from);
      await link.connection.setRemoteDescription(data.offer);
      const answer = await link.connection.createAnswer();
      await link.connection.setLocalDescription(answer);
      this.send("voice-signal", { to: from, data: { answer } });
    } else if ("answer" in data) {
      await this.links.get(from)?.connection.setRemoteDescription(data.answer);
    } else if ("ice" in data) {
      await this.links.get(from)?.connection.addIceCandidate(data.ice).catch(() => undefined);
    }
  }

  private async call(tag: string) {
    const link = this.open(tag);
    const offer = await link.connection.createOffer();
    await link.connection.setLocalDescription(offer);
    this.send("voice-signal", { to: tag, data: { offer } });
  }

  private open(tag: string): Link {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = new Audio();
    audio.autoplay = true;
    const link: Link = { connection, audio };
    this.links.set(tag, link);
    this.microphone?.getTracks().forEach((track) => connection.addTrack(track, this.microphone!));
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.send("voice-signal", { to: tag, data: { ice: event.candidate.toJSON() } });
      }
    };
    connection.ontrack = (event) => {
      const [stream] = event.streams;
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      link.level = this.analyse(stream);
    };
    connection.onconnectionstatechange = () => {
      // A link that broke is dropped; the next team status brings it back if the teammate still talks.
      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        if (this.links.get(tag) === link) {
          this.close(tag);
        }
      }
    };
    return link;
  }

  private close(tag: string) {
    const link = this.links.get(tag);
    if (!link) {
      return;
    }
    this.links.delete(tag);
    link.connection.close();
    link.audio.srcObject = null;
  }

  private analyse(stream: MediaStream) {
    if (!this.audioContext) {
      return undefined;
    }
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    this.audioContext.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  private measure() {
    if (!this.microphone) {
      return;
    }
    const loud = (analyser?: AnalyserNode) => {
      if (!analyser) {
        return false;
      }
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      return Math.sqrt(sum / samples.length) > SPEAKING;
    };
    const speaking = new Set<string>();
    if (loud(this.meter)) {
      speaking.add("me");
    }
    for (const [tag, link] of this.links) {
      if (loud(link.level)) {
        speaking.add(tag);
      }
    }
    this.onSpeaking(speaking);
  }
}
