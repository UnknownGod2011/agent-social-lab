import type { Arm } from "../types";
import { buildRoom } from "./layout";
import { windowArt, wallSign } from "./art";
export const roomAccents: Record<Arm, string> = {
  A: "#81cede",
  B: "#b9a2ed",
  C: "#f2a076",
  D: "#66cbb9",
};
export const names: Record<Arm, string> = {
  A: "Focus studio",
  B: "Reflection nook",
  C: "The commons",
  D: "Listening room",
};
export const descriptions: Record<Arm, string> = {
  A: "The crew works together and takes its scheduled breaks in silence.",
  B: "Each crew member spends the break writing a private non-task journal.",
  C: "The crew shares a table for informal conversation between work sessions.",
  D: "The crew reads a matched conversation during the scheduled break.",
};
export const sceneModel = (arm: Arm) =>
  buildRoom(arm, roomAccents[arm], windowArt, wallSign(arm, roomAccents[arm]));
