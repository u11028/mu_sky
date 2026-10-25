// Team voice chat. Whoever has their microphone on is heard by every teammate: each pair of
// teammates where at least one talks gets a direct audio link (WebRTC); the game server only passes
// on the few messages that set a link up.
//
// Who to link with comes from the team status the server sends every second. Of each pair, the one
// with the smaller voice tag makes the offer, and only it decides when a link must be made again
// (when either side turns their microphone on or off, since what it carries changes): the other
// side may hear of a teammate's microphone a second later than the offer, and must not drop a good
// link over that. It only drops its links when its own microphone changes, and waits for the offer.

export interface VoiceMate {
  voice: string;
  talking: boolean;
  online: boolean;
  me: boolean;
  name: string;
}

type Signal = { offer: RTCSessionDescriptionInit } | { answer: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit };

interface Link {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** How loud they are now, for the "speaking" light. */
  level?: AnalyserNode;
  /** Who talked when the link was made: when that changes, it is made again. */
  mineOn: boolean;
  theirsOn: boolean;
  name: string;
  /** Routes that came before the other side's description: added once it is in. */
  early: RTCIceCandidateInit[];
}

// Public STUN servers let two phones behind home routers find a way to each other.
const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
/** Loudness (0 to 1) above which someone counts as speaking. */
const SPEAKING = 0.04;

export interface VoiceEvents {
  /** Who is speaking now (voice tags; "me" for the local player), a few times a second. */
  speaking(tags: Set<string>): void;
  /** The browser would not play a teammate's voice before a touch: ask for one. */
  blocked(): void;
  /** No route between the two browsers could be found (some mobile networks need a relay server). */
  failed(name: string): void;
}

export class Voice {
  private microphone?: MediaStream;
  private links = new Map<string, Link>();
  private myTag = "";
  private audioContext?: AudioContext;
  private meter?: AnalyserNode;
  /** Voices the browser refused to start; tried again on the next touch or key. */
  private waiting = new Set<HTMLAudioElement>();

  constructor(
    private readonly send: (type: string, message: unknown) => void,
    private readonly events: VoiceEvents,
  ) {
    setInterval(() => this.measure(), 200);
    const unblock = () => {
      void this.audioContext?.resume();
      for (const audio of this.waiting) {
        void audio.play().then(() => this.waiting.delete(audio), () => undefined);
      }
    };
    addEventListener("pointerdown", unblock, true);
    addEventListener("keydown", unblock, true);
  }

  /** Whether the microphone is on. */
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
    this.meter = this.analyse(this.microphone);
    this.send("voice", { on: true });
  }

  /** Turns the microphone off; teammates who talk are still heard. */
  stop() {
    if (this.microphone) {
      this.send("voice", { on: false });
    }
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.microphone = undefined;
    this.meter = undefined;
  }

  /** Off the team: no microphone, no links. */
  leave() {
    this.stop();
    for (const tag of [...this.links.keys()]) {
      this.close(tag);
    }
    this.events.speaking(new Set());
  }

  /** The server lost track of us (a new connection after travelling or reconnecting): say again that we talk. */
  announce() {
    if (this.microphone) {
      this.send("voice", { on: true });
    }
  }

  /** The team as it is now: a link to each teammate when either of us talks, none otherwise. */
  syncTeam(mates: VoiceMate[]) {
    const me = mates.find((mate) => mate.me);
    if (me) {
      this.myTag = me.voice;
    }
    const others = new Map(mates.filter((mate) => !mate.me && mate.online).map((mate) => [mate.voice, mate]));
    for (const [tag, link] of [...this.links]) {
      const mate = others.get(tag);
      const offering = this.myTag < tag;
      const stale = !mate || link.mineOn !== this.on || (offering && link.theirsOn !== mate.talking);
      if (stale) {
        this.close(tag);
      }
    }
    for (const [tag, mate] of others) {
      if ((this.on || mate.talking) && !this.links.has(tag) && this.myTag && this.myTag < tag) {
        void this.call(tag, mate).catch(() => this.close(tag));
      }
    }
  }

  async receive(from: string, data: Signal, mate?: VoiceMate) {
    if ("offer" in data) {
      // A teammate calls: answer on a fresh link, sending our voice too if the microphone is on.
      this.close(from);
      const link = this.open(from, mate);
      await link.connection.setRemoteDescription(data.offer);
      await this.addEarlyRoutes(link);
      this.microphone?.getTracks().forEach((track) => link.connection.addTrack(track, this.microphone!));
      const answer = await link.connection.createAnswer();
      await link.connection.setLocalDescription(answer);
      this.send("voice-signal", { to: from, data: { answer } });
    } else if ("answer" in data) {
      const link = this.links.get(from);
      if (link) {
        await link.connection.setRemoteDescription(data.answer);
        await this.addEarlyRoutes(link);
      }
    } else if ("ice" in data) {
      const link = this.links.get(from);
      // Routes often arrive right behind the offer or answer, before it has been taken in: keep them.
      if (link && !link.connection.remoteDescription) {
        link.early.push(data.ice);
      } else {
        await link?.connection.addIceCandidate(data.ice).catch(() => undefined);
      }
    }
  }

  private async addEarlyRoutes(link: Link) {
    for (const route of link.early.splice(0)) {
      await link.connection.addIceCandidate(route).catch(() => undefined);
    }
  }

  private async call(tag: string, mate: VoiceMate) {
    const link = this.open(tag, mate);
    if (this.microphone) {
      this.microphone.getTracks().forEach((track) => link.connection.addTrack(track, this.microphone!));
    } else {
      // Only listening: ask for their voice without sending any.
      link.connection.addTransceiver("audio", { direction: "recvonly" });
    }
    const offer = await link.connection.createOffer();
    await link.connection.setLocalDescription(offer);
    this.send("voice-signal", { to: tag, data: { offer } });
  }

  private open(tag: string, mate?: VoiceMate): Link {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = new Audio();
    audio.autoplay = true;
    const link: Link = { connection, audio, mineOn: this.on, theirsOn: mate?.talking ?? true, name: mate?.name ?? "", early: [] };
    this.links.set(tag, link);
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.send("voice-signal", { to: tag, data: { ice: event.candidate.toJSON() } });
      }
    };
    connection.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => {
        this.waiting.add(audio);
        this.events.blocked();
      });
      link.level = this.analyse(audio.srcObject as MediaStream);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed" && this.links.get(tag) === link) {
        this.events.failed(link.name);
        this.close(tag);
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
    this.waiting.delete(link.audio);
    link.audio.srcObject = null;
  }

  private analyse(stream: MediaStream) {
    try {
      this.audioContext ??= new AudioContext();
      void this.audioContext.resume();
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      this.audioContext.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    } catch {
      // No light for this voice; it is still heard.
      return undefined;
    }
  }

  private measure() {
    if (!this.microphone && this.links.size === 0) {
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
    this.events.speaking(speaking);
  }
}
