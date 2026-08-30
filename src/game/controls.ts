import * as THREE from "three";
import { H, W } from "./coords";

/**
 * RTS-style orbit camera.
 *
 * Not a first-person controller, on purpose. STRATA is about laying out a city
 * and reading a cross-section of ground, and both of those want an overview
 * you can circle. Pointer lock would also make left-click-to-mine and
 * click-to-place UI mutually exclusive, which is a bad trade.
 *
 * Left mouse is reserved entirely for the game. Camera movement lives on right
 * drag, middle drag, the scroll wheel and the keyboard.
 */

export interface CameraRay {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

const MIN_DISTANCE = 8;
const MAX_DISTANCE = 190;
const MIN_POLAR = 0.08;
const MAX_POLAR = Math.PI * 0.495;

export class OrbitCamera {
  /** The point the camera looks at, in voxel coordinates. */
  readonly target = new THREE.Vector3(W / 2, H * 0.6, W / 2);

  #distance = 74;
  #azimuth = Math.PI * 0.25;
  #polar = Math.PI * 0.32;

  // Desired values; the actual camera eases toward these every frame.
  #wantDistance = 74;
  #wantAzimuth = Math.PI * 0.25;
  #wantPolar = Math.PI * 0.32;
  readonly #wantTarget = new THREE.Vector3(W / 2, H * 0.6, W / 2);

  #keys = new Set<string>();
  #dragMode: "none" | "orbit" | "pan" = "none";
  #lastX = 0;
  #lastY = 0;
  #pointers = new Map<number, { x: number; y: number }>();
  #pinchDistance = 0;

  #element: HTMLElement | null = null;
  #enabled = true;
  /** Set while a modal or panel has focus, so WASD doesn't move the camera. */
  #inputBlocked = false;

  readonly pointer = new THREE.Vector2(-2, -2);
  #hasPointer = false;

  attach(element: HTMLElement): void {
    this.#element = element;

    element.addEventListener("pointerdown", this.#onPointerDown);
    element.addEventListener("pointermove", this.#onPointerMove);
    element.addEventListener("pointerup", this.#onPointerUp);
    element.addEventListener("pointercancel", this.#onPointerUp);
    element.addEventListener("pointerleave", this.#onPointerLeave);
    element.addEventListener("wheel", this.#onWheel, { passive: false });
    element.addEventListener("contextmenu", this.#onContextMenu);

    window.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onBlur);
  }

  detach(): void {
    const element = this.#element;
    if (element) {
      element.removeEventListener("pointerdown", this.#onPointerDown);
      element.removeEventListener("pointermove", this.#onPointerMove);
      element.removeEventListener("pointerup", this.#onPointerUp);
      element.removeEventListener("pointercancel", this.#onPointerUp);
      element.removeEventListener("pointerleave", this.#onPointerLeave);
      element.removeEventListener("wheel", this.#onWheel);
      element.removeEventListener("contextmenu", this.#onContextMenu);
    }

    window.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("keyup", this.#onKeyUp);
    window.removeEventListener("blur", this.#onBlur);

    this.#element = null;
    this.#keys.clear();
    this.#pointers.clear();
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.#dragMode = "none";
  }

  /** Called when a text input takes focus, so typing "was" doesn't pan. */
  setInputBlocked(blocked: boolean): void {
    this.#inputBlocked = blocked;
    if (blocked) this.#keys.clear();
  }

  get hasPointer(): boolean {
    return this.#hasPointer;
  }

  get isDragging(): boolean {
    return this.#dragMode !== "none";
  }

  get distance(): number {
    return this.#distance;
  }

  /* ======================================================================
     Pointer
     ====================================================================== */

  #onPointerDown = (event: PointerEvent): void => {
    if (!this.#enabled) return;
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (event.pointerType === "touch") {
      if (this.#pointers.size === 1) {
        this.#dragMode = "orbit";
        this.#lastX = event.clientX;
        this.#lastY = event.clientY;
      } else if (this.#pointers.size === 2) {
        this.#dragMode = "pan";
        this.#pinchDistance = this.#touchSpread();
      }
      return;
    }

    // Button 2 is right, 1 is middle. Left (0) belongs to the game.
    if (event.button === 2) this.#dragMode = "orbit";
    else if (event.button === 1 || (event.button === 0 && event.shiftKey)) this.#dragMode = "pan";
    else return;

    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.#element?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  #onPointerMove = (event: PointerEvent): void => {
    const rect = this.#element?.getBoundingClientRect();
    if (rect) {
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.#hasPointer = true;
    }

    if (this.#pointers.has(event.pointerId)) {
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (!this.#enabled || this.#dragMode === "none") return;

    if (event.pointerType === "touch" && this.#pointers.size === 2) {
      const spread = this.#touchSpread();
      const delta = spread - this.#pinchDistance;
      this.#pinchDistance = spread;
      this.#wantDistance = clamp(this.#wantDistance - delta * 0.25, MIN_DISTANCE, MAX_DISTANCE);
      return;
    }

    const dx = event.clientX - this.#lastX;
    const dy = event.clientY - this.#lastY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;

    if (this.#dragMode === "orbit") {
      this.#wantAzimuth -= dx * 0.005;
      this.#wantPolar = clamp(this.#wantPolar - dy * 0.005, MIN_POLAR, MAX_POLAR);
    } else {
      // Pan speed scales with distance so the world moves the same amount
      // under the cursor whether you're zoomed in on a drill or out to orbit.
      const speed = this.#distance * 0.0016;
      this.#panRelative(-dx * speed, dy * speed);
    }
  };

  #onPointerUp = (event: PointerEvent): void => {
    this.#pointers.delete(event.pointerId);
    if (this.#pointers.size === 0) this.#dragMode = "none";
    if (this.#element?.hasPointerCapture(event.pointerId)) {
      this.#element.releasePointerCapture(event.pointerId);
    }
  };

  #onPointerLeave = (): void => {
    this.#hasPointer = false;
    this.pointer.set(-2, -2);
  };

  #onWheel = (event: WheelEvent): void => {
    if (!this.#enabled) return;
    event.preventDefault();
    // Multiplicative zoom keeps the *feel* constant across the whole range.
    const factor = Math.exp(event.deltaY * 0.0012);
    this.#wantDistance = clamp(this.#wantDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
  };

  #onContextMenu = (event: Event): void => {
    // Right-drag is the orbit gesture, so the browser menu has to go.
    event.preventDefault();
  };

  #touchSpread(): number {
    const points = Array.from(this.#pointers.values());
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  /* ======================================================================
     Keyboard
     ====================================================================== */

  #onKeyDown = (event: KeyboardEvent): void => {
    if (this.#inputBlocked) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }
    this.#keys.add(event.code);
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    this.#keys.delete(event.code);
  };

  #onBlur = (): void => {
    // Without this, alt-tabbing mid-pan leaves the camera drifting forever.
    this.#keys.clear();
    this.#dragMode = "none";
  };

  /* ======================================================================
     Movement
     ====================================================================== */

  /** Pans in the camera's own XZ plane, ignoring pitch. */
  #panRelative(right: number, forward: number): void {
    const sin = Math.sin(this.#azimuth);
    const cos = Math.cos(this.#azimuth);

    this.#wantTarget.x += right * cos - forward * sin;
    this.#wantTarget.z += right * sin + forward * cos;

    // Keep the focus inside the claim, with a little slack past the edge.
    this.#wantTarget.x = clamp(this.#wantTarget.x, -12, W + 12);
    this.#wantTarget.z = clamp(this.#wantTarget.z, -12, W + 12);
    this.#wantTarget.y = clamp(this.#wantTarget.y, 2, H - 4);
  }

  update(dt: number): void {
    if (this.#enabled && !this.#inputBlocked && this.#keys.size > 0) {
      const speed = this.#distance * 0.9 * dt * (this.#keys.has("ShiftLeft") ? 2.4 : 1);
      let right = 0;
      let forward = 0;

      if (this.#keys.has("KeyW") || this.#keys.has("ArrowUp")) forward += speed;
      if (this.#keys.has("KeyS") || this.#keys.has("ArrowDown")) forward -= speed;
      if (this.#keys.has("KeyA") || this.#keys.has("ArrowLeft")) right -= speed;
      if (this.#keys.has("KeyD") || this.#keys.has("ArrowRight")) right += speed;
      if (right !== 0 || forward !== 0) this.#panRelative(right, forward);

      if (this.#keys.has("KeyQ")) this.#wantAzimuth += dt * 1.3;
      if (this.#keys.has("KeyE")) this.#wantAzimuth -= dt * 1.3;
      if (this.#keys.has("KeyR")) this.#wantTarget.y = clamp(this.#wantTarget.y + speed * 0.55, 2, H - 4);
      if (this.#keys.has("KeyF")) this.#wantTarget.y = clamp(this.#wantTarget.y - speed * 0.55, 2, H - 4);
    }

    // Frame-rate independent easing. The 1 - e^(-k·dt) form keeps the same
    // settling time at 30fps and 144fps, which a naive lerp does not.
    const ease = 1 - Math.exp(-14 * dt);
    this.#distance += (this.#wantDistance - this.#distance) * ease;
    this.#azimuth += (this.#wantAzimuth - this.#azimuth) * ease;
    this.#polar += (this.#wantPolar - this.#polar) * ease;
    this.target.lerp(this.#wantTarget, ease);
  }

  applyTo(camera: THREE.PerspectiveCamera): void {
    const sinPolar = Math.sin(this.#polar);
    camera.position.set(
      this.target.x + this.#distance * sinPolar * Math.sin(this.#azimuth),
      this.target.y + this.#distance * Math.cos(this.#polar),
      this.target.z + this.#distance * sinPolar * Math.cos(this.#azimuth)
    );
    camera.lookAt(this.target);
  }

  /** Snaps the focus somewhere, e.g. when jumping to a building. */
  focusOn(x: number, y: number, z: number, distance?: number): void {
    this.#wantTarget.set(x, y, z);
    if (distance !== undefined) {
      this.#wantDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    }
  }

  /** Camera pose for the intro fly-in, without touching user input state. */
  setPose(azimuth: number, polar: number, distance: number): void {
    this.#wantAzimuth = azimuth;
    this.#azimuth = azimuth;
    this.#wantPolar = clamp(polar, MIN_POLAR, MAX_POLAR);
    this.#polar = this.#wantPolar;
    this.#wantDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    this.#distance = this.#wantDistance;
  }

  /** Ray through the current pointer position, for block picking. */
  rayFromPointer(camera: THREE.PerspectiveCamera): CameraRay | null {
    if (!this.#hasPointer) return null;

    const origin = camera.position.clone();
    const direction = new THREE.Vector3(this.pointer.x, this.pointer.y, 0.5)
      .unproject(camera)
      .sub(origin)
      .normalize();

    return { origin, direction };
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
