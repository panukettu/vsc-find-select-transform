import path from "node:path";

import * as vscode from "vscode";

import { EXTENSION_ID } from "../config/config.common";
import type { Transform } from "../types";
import { getCursorLine, getFullRange } from "../utils/utils";
import { Command } from "./command";

type Override = { override?: Transform[] };

export const TranspileSource = new Command(
  "transform.transpile",
  async ({ state }) => {
    if (!state.hasTransformsFile) {
      const src = state.config.transform.src;
      const choice = await vscode.window.showInformationMessage(
        src
          ? `No transforms file at ${src}`
          : `"${EXTENSION_ID}.transform.src" cannot be resolved without an open folder.`,
        "Create example file",
        "Open settings",
      );
      if (choice === "Create example file") await state.createExampleTransforms();
      if (choice === "Open settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          `${EXTENSION_ID}.transform.src`,
        );
      }
      return;
    }

    const result = await state.transpile({ force: true });
    if (result) {
      const count = state.transforms.all.length;
      vscode.window.setStatusBarMessage(
        `Transpiled ${path.basename(result.source)}: ${count} transform${count === 1 ? "" : "s"}`,
        4000,
      );
    }
  },
  { editor: false },
);

export const TransformSelection = new Command<Override>(
  "transform.selection",
  ({ state, override }) => {
    return state.execTransforms((editor) => editor.selections, {
      type: "range",
      applyEdits: true,
      override,
    });
  },
);

export const TransformSelectionWith = new Command("transform.selectionWith", ({ state }) => {
  return state.execTransforms((editor) => editor.selections, {
    type: "range",
    pick: true,
    applyEdits: true,
  });
});

export const TransformCursorLine = new Command<Override>(
  "transform.cursorLine",
  ({ state, override }) => {
    return (
      state.getUndo()?.() ??
      state.execTransforms((editor) => [getCursorLine(editor).range], {
        type: "cursor",
        saveUndo: true,
        applyEdits: true,
        override,
      })
    );
  },
);

export const TransformCursorLineWith = new Command("transform.cursorLineWith", ({ state }) => {
  return (
    state.getUndo()?.() ??
    state.execTransforms((editor) => [getCursorLine(editor).range], {
      type: "cursor",
      pick: true,
      saveUndo: true,
      applyEdits: true,
    })
  );
});

export const TransformFile = new Command("transform.activeFile", ({ state }) => {
  return state.execTransforms((editor) => [getFullRange(editor)], {
    type: "range",
    applyEdits: true,
  });
});

export const TransformFileWith = new Command("transform.activeFileWith", ({ state }) => {
  return state.execTransforms((editor) => [getFullRange(editor)], {
    type: "range",
    pick: true,
    applyEdits: true,
  });
});

export const UndoAtCursor = new Command("transform.undoAtCursor", ({ state }) => {
  return state.undos.undoAtCursor();
});

export const TransformRepeat = new Command("transform.repeat", ({ state, activeEditor }) => {
  if (!state.prev.transforms) return;

  const { range, cursor } = state.prev.transforms;

  if (!activeEditor.selection.isEmpty && range?.length) {
    return TransformSelection.execute({ override: range });
  }

  if (cursor?.length) {
    return TransformCursorLine.execute({ override: cursor });
  }
});
