import z from 'zod';
import type { MessageV2 } from '../session/message-v2';
import type { ToolResultOutput } from 'ai';

export namespace Tool {
  interface Metadata {
    [key: string]: any;
  }

  export interface Result<M extends Metadata = Metadata> {
    title: string;
    metadata: M;
    output: string;
    isError?: boolean;
    attachments?: MessageV2.FilePart[];
  }

  // AI SDK 7 passes an options object containing the execution output.
  export function toModelOutput({
    output: result,
  }: {
    output: Pick<Result, 'output' | 'isError'>;
  }): ToolResultOutput {
    return {
      type: result.isError ? 'error-text' : 'text',
      value: result.output,
    };
  }

  export function toState(
    result: Result,
    input: { input: Record<string, any>; time: { start: number; end: number } }
  ): MessageV2.ToolStateCompleted | MessageV2.ToolStateError {
    if (result.isError) {
      return {
        ...input,
        status: 'error',
        error: result.output,
        metadata: result.metadata,
        title: result.title,
        attachments: result.attachments,
      };
    }
    return {
      ...input,
      status: 'completed',
      output: result.output,
      title: result.title,
      metadata: result.metadata,
      attachments: result.attachments,
    };
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    callID?: string;
    extra?: { [key: string]: any };
    metadata(input: { title?: string; metadata?: M }): void;
  };
  export interface Info<
    Parameters extends z.ZodType = z.ZodType,
    M extends Metadata = Metadata,
  > {
    id: string;
    init: () => Promise<{
      description: string;
      parameters: Parameters;
      execute(args: z.infer<Parameters>, ctx: Context): Promise<Result<M>>;
      formatValidationError?(error: z.ZodError): string;
    }>;
  }

  export type InferParameters<T extends Info> =
    T extends Info<infer P> ? z.infer<P> : never;
  export type InferMetadata<T extends Info> =
    T extends Info<any, infer M> ? M : never;

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init:
      | Info<Parameters, Result>['init']
      | Awaited<ReturnType<Info<Parameters, Result>['init']>>
  ): Info<Parameters, Result> {
    return {
      id,
      init: async () => {
        const toolInfo = init instanceof Function ? await init() : init;
        const execute = toolInfo.execute;
        toolInfo.execute = (args, ctx) => {
          try {
            toolInfo.parameters.parse(args);
          } catch (error) {
            if (error instanceof z.ZodError && toolInfo.formatValidationError) {
              throw new Error(toolInfo.formatValidationError(error), {
                cause: error,
              });
            }
            throw new Error(
              `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
              { cause: error }
            );
          }
          return execute(args, ctx);
        };
        return toolInfo;
      },
    };
  }
}
