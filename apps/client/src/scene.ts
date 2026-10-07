import type { Application } from 'pixi.js';
import type { User } from './api';

export type Target =
  | { kind: 'building' }
  | { kind: 'hall' }
  | { kind: 'apartment'; ownerId: string };

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind !== 'apartment' || a.ownerId === (b as typeof a).ownerId);

/** What a scene may ask of the application around it. */
export interface SceneHost {
  app: Application;
  user: User;
  go(target: Target): void;
  notify(text: string): void;
}

export interface Scene {
  /** Shown in the side column while the scene is active. */
  panel: HTMLElement;
  /** Canvas size in game pixels; the application scales it to the window. */
  size: { w: number; h: number };
  /** Reload what the scene shows from the server (after furniture or the look changed). */
  refresh?(): void | Promise<void>;
  destroy(): void;
}

export const FONT = '"Press Start 2P", ui-monospace, monospace';
