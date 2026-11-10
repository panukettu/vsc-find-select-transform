import * as vscode from "vscode";

import { DisableKeyBindings } from "./commands/commands.general";
import * as Motions from "./commands/commands.motions";
import * as Transforms from "./commands/commands.transform";
import { EXTENSION_ID } from "./config/config.common";
import { transform } from "./handlers/handler.ext";
import { motion } from "./handlers/handler.motions";
import { createState } from "./state/state";
import type { ExtMotionArgs, ExtTransformArgs, TFilter, Transform } from "./types";
import { openLocation } from "./utils/utils";

/**
 * Activates the extension and returns its public API, which other extensions can
 * reach via `vscode.extensions.getExtension('0xp.find-select-transform').exports`.
 */
export function activate(ctx: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel(EXTENSION_ID, { log: true });
  const state = createState({ ctx, channel });
  state.registerCommands(
    ...Object.values(Transforms),
    ...Object.values(Motions),
    DisableKeyBindings,
  );

  return {
    /** True once the transforms file has been transpiled and loaded. */
    isReady: () => !!state.prev.transpile?.js,
    getTransforms: (filter?: TFilter) => state.getAvailableTransforms({ filter }),
    /** Transpiles the transforms file. Pass `false` to reuse the cached output when inputs are unchanged. */
    transpile: (force = true) => state.transpile({ force }),
    createExampleTransforms: () => state.createExampleTransforms(),
    transform: <T extends Transform[] | TFilter>(args: ExtTransformArgs<T>) =>
      transform<T>(state, args),
    motion: async <T = Record<"select" | "delete", vscode.Selection[]>>(
      value: string,
      args?: ExtMotionArgs<T>,
    ) => {
      const editor = args?.location
        ? "range" in args.location
          ? await openLocation(args.location)
          : args?.location
        : undefined;
      return motion<T>({
        args: {
          inputOverride: value,
          ...args,
          state,
          editor,
        },
        onMotion: args?.onMotion ?? ["select"],
      });
    },
    getStatus: () => ({
      isReady: !!state.prev.transpile?.js,
      transforms: state.transforms.labels,
      isTranspiling: !!state.pendingTranspile,
      prev: state.prev,
      config: state.config,
    }),
    getCommands: async () =>
      (await vscode.commands.getCommands(true)).filter((c) => c.startsWith(EXTENSION_ID)),
    getConfig: () => state.config,
  };
}

export function deactivate() {}

export type SelectTransform = ReturnType<typeof activate>;
