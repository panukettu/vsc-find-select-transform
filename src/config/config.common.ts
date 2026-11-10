import * as path from "node:path";

import * as vscode from "vscode";

import { getSourcePath } from "./config.transformer";

export const EXTENSION_ID = "find-select-transform" as const;

export const settings = <T = unknown>(key: string, defaultValue?: T) => {
  return vscode.workspace.getConfiguration(EXTENSION_ID).get(key, defaultValue as T);
};

type CommandAssociation = { cursor: string[]; range: string[] };
type AssociatedTransforms = string[] | CommandAssociation;

export type JumpSelection = "input" | "first-input" | "first-word" | "words" | "start" | "end";

/**
 * Resolves the transforms associated with a file (by path or `.ext`). Falls back
 * to the `*` entry when the extension has no entry of its own.
 */
export function getAssociations(
  filepathOrExtension?: string | `.${string}`,
): CommandAssociation & { ext: string } {
  let ext = "";
  if (filepathOrExtension) {
    ext = filepathOrExtension.startsWith(".")
      ? filepathOrExtension.slice(1)
      : path.extname(filepathOrExtension).slice(1);
  }
  const associations =
    settings<Record<string, AssociatedTransforms>>("transform.associations", {}) ?? {};
  const entry = ext && ext in associations ? associations[ext] : associations["*"];

  return { ...parseAssociations(entry ?? []), ext };
}

function parseAssociations(transforms: AssociatedTransforms): CommandAssociation {
  if (Array.isArray(transforms)) return { cursor: transforms, range: transforms };
  if (transforms && typeof transforms === "object") {
    return { cursor: transforms.cursor ?? [], range: transforms.range ?? [] };
  }
  return { cursor: [], range: [] };
}

export function getRootPath(document = vscode.window.activeTextEditor?.document) {
  const uri = document?.uri ?? vscode.window.visibleTextEditors[0]?.document.uri;
  const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
  return (folder ?? vscode.workspace.workspaceFolders?.[0])?.uri.fsPath ?? "";
}

export type Config = ReturnType<typeof getConfig>;

export function getConfig(document = vscode.window.activeTextEditor?.document) {
  const rootPath = getRootPath(document);
  return {
    rootPath,
    transform: {
      disableUndoToggle: settings("transform.disableUndoToggle", false),
      watch: settings("transform.watch", false),
      associations: getAssociations(document?.fileName),
      src: getSourcePath(rootPath),
    },
    motion: {
      search: {
        jumpResultThreshold: settings<number>("search.jumpResultThreshold", 0) || 0,
        jumpInputThreshold: settings<number>("search.jumpInputThreshold", 2) ?? 2,
        jumpSelection: settings<JumpSelection>("search.jumpSelection", "input") ?? "input",
      },
    },
  };
}
