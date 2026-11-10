import * as vscode from "vscode";

import type { CommandHandler } from "../types";

export type CommandOptions = {
  /** Whether the command needs an active text editor to run. Defaults to true. */
  editor: boolean;
};

export class Command<
  Args extends object = any,
  Name extends string = string,
  Handler extends CommandHandler<Args> = CommandHandler<Args>,
  Result extends ReturnType<Handler> = ReturnType<Handler>,
> {
  name: Name;
  id: `find-select-transform.${Name}`;
  handler: Handler;
  options: CommandOptions;

  /** Runs the command through VS Code. Object arguments are merged into the handler's args. */
  execute(...args: any[]) {
    return vscode.commands.executeCommand<Result>(this.id, ...args);
  }

  constructor(name: Name, handler: Handler, options?: Partial<CommandOptions>) {
    this.handler = handler;
    this.name = name;
    this.id = `find-select-transform.${this.name}` as const;
    this.options = { editor: true, ...options };
  }
}
