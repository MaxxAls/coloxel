import type { Application, Container } from 'pixi.js';
import type { User } from './api';

export type Target =
  | { kind: 'building' }
  | { kind: 'hall' }
  | { kind: 'apartment'; ownerId: string };

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind !== 'apartment' || a.ownerId === (b as typeof a).ownerId);

/** The floating windows a scene may ask the game to open. */
export type WindowKey = 'inventory' | 'apartment' | 'history';

/** What a scene may ask of the application around it. */
export interface SceneHost {
  app: Application;
  /** Where a scene puts its world: the application scales and centres it in the window. */
  stage: Container;
  /** A mouse event position in the scene's own pixels. */
  pointer(ev: MouseEvent): { x: number; y: number };
  user: User;
  go(target: Target): void;
  notify(text: string): void;
  /** The friends list may have changed (a request was sent from a player card). */
  friendsChanged(): void;
  /** Open one of the windows the scene provides, or close them all (null). */
  openWindow(key: WindowKey | null): void;
}

export interface Scene {
  /** The card at the top left: where we are, who is here, where to go. */
  info: HTMLElement;
  /** Our things and the form to invent one (only in our own apartment). */
  inventory?: HTMLElement;
  /** Name, opening and mechanisms of our apartment (only in our own apartment). */
  apartment?: HTMLElement;
  /** What was said lately, with a way to report it (rooms). */
  history?: HTMLElement;
  /** The line where the player types, put in the bottom bar (rooms). */
  chatBar?: HTMLElement;
  /** Canvas size in game pixels; the application scales it to the window. */
  size: { w: number; h: number };
  /** Reload what the scene shows from the server (after furniture or the look changed). */
  refresh?(): void | Promise<void>;
  /** I changed my look or my companion: tell the room so that everybody sees it. */
  refreshAppearance?(): void;
  destroy(): void;
}

export const FONT = '"Press Start 2P", ui-monospace, monospace';
