// The hero shown on the join screen: turning slowly on a little stage, changed with arrows.

import * as THREE from "three";
import { HEROES } from "../../../shared/heroes.ts";
import { type Actor, heroActor } from "./actors.ts";

export class HeroPicker {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private actor?: Actor;
  private shown = -1;
  private frame = 0;
  private last = performance.now();

  constructor(
    stage: HTMLElement,
    private index: number,
    private readonly onChange: (index: number) => void,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    stage.append(this.renderer.domElement);
    const size = () => {
      const width = stage.clientWidth || 200;
      const height = stage.clientHeight || 220;
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(size).observe(stage);
    size();

    this.camera.position.set(0, 2.2, 6.4);
    this.camera.lookAt(0, 1.05, 0);
    this.scene.add(new THREE.HemisphereLight("#cfe8ff", "#3b5b2f", 1.4));
    const key = new THREE.DirectionalLight("#fff1d6", 2.6);
    key.position.set(-3, 6, 4);
    key.castShadow = true;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#9be7ff", 1.6);
    rim.position.set(3, 3, -4);
    this.scene.add(rim);

    // A round grassy stage with a gold rim.
    const stageTop = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.35, 0.25, 40),
      new THREE.MeshStandardMaterial({ color: "#6dbb55", roughness: 0.9 }),
    );
    stageTop.position.y = -0.125;
    stageTop.receiveShadow = true;
    const rimRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.05, 8, 48),
      new THREE.MeshStandardMaterial({ color: "#e9c46a", metalness: 0.6, roughness: 0.3 }),
    );
    rimRing.rotation.x = Math.PI / 2;
    this.scene.add(stageTop, rimRing);

    this.show(index);
    this.loop();
  }

  get value() {
    return this.index;
  }

  /** Goes to the next (+1) or previous (-1) hero. */
  step(by: number) {
    this.show((this.index + by + HEROES.length) % HEROES.length);
  }

  show(index: number) {
    this.index = ((index % HEROES.length) + HEROES.length) % HEROES.length;
    this.onChange(this.index);
    const wanted = this.index;
    void heroActor(HEROES[wanted]).then((actor) => {
      // A quicker click may have moved on already.
      if (wanted !== this.index || wanted === this.shown) {
        actor.dispose();
        return;
      }
      this.actor?.dispose();
      this.actor = actor;
      this.shown = wanted;
      actor.label.object.element.remove();
      actor.root.remove(actor.label.object);
      actor.root.rotation.y = 0.5;
      this.scene.add(actor.root);
      actor.once("spawn");
    });
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    // Nothing to draw while the join screen is hidden.
    if (!this.renderer.domElement.isConnected || this.renderer.domElement.offsetParent === null) {
      return;
    }
    const now = performance.now();
    const delta = Math.min(100, now - this.last);
    this.last = now;
    if (this.actor) {
      this.actor.facing += delta / 2600;
      this.actor.update(delta, now);
    }
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
  }
}
