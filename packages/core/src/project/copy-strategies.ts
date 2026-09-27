import { Effect } from "effect"
import { cp } from "fs/promises"
import os from "os"
import path from "path"
import { AbsolutePath } from "../schema"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { DirectoryUnavailableError, StrategyID, type ListEntry, type Strategy } from "./copy"

// Installed dependencies can be reinstalled in the copy and would make copying slow.
const SKIPPED_DIRECTORIES = new Set(["node_modules"])

export function makeDirectoryCopyStrategy(input: {
  fs: FSUtil.Interface
  canonical: (directory: AbsolutePath) => Effect.Effect<AbsolutePath, DirectoryUnavailableError>
}) {
  return {
    id: StrategyID.make("directory_copy"),
    create: Effect.fn("ProjectCopy.DirectoryCopy.create")(function* (options) {
      // Refuse sources that are almost certainly not a project, such as the global project's root.
      if (
        options.sourceDirectory === path.parse(options.sourceDirectory).root ||
        options.sourceDirectory === (yield* input.canonical(AbsolutePath.make(os.homedir())))
      )
        return yield* new DirectoryUnavailableError({ directory: options.sourceDirectory })
      // FileSystem.copy has no filter option, so use node's cp to skip dependency directories.
      yield* Effect.tryPromise({
        try: () =>
          cp(options.sourceDirectory, options.directory, {
            recursive: true,
            errorOnExist: true,
            force: false,
            verbatimSymlinks: true,
            filter: (source) => !SKIPPED_DIRECTORIES.has(path.basename(source)),
          }),
        catch: () => new DirectoryUnavailableError({ directory: options.directory }),
      })
      return { directory: yield* input.canonical(options.directory) }
    }),
    // A plain copy has no uncommitted-changes check like git worktrees, so `force` has nothing to guard.
    remove: Effect.fn("ProjectCopy.DirectoryCopy.remove")(function* (options) {
      yield* input.fs
        .remove(options.directory, { recursive: true })
        .pipe(Effect.mapError(() => new DirectoryUnavailableError({ directory: options.directory })))
    }),
    // Plain copies leave no trace in the source directory, so they are only known through their stored project_directory rows.
    list: () => Effect.succeed([]),
  } satisfies Strategy
}

export function makeGitWorktreeStrategy(input: {
  git: Git.Interface
  canonical: (directory: AbsolutePath) => Effect.Effect<AbsolutePath, DirectoryUnavailableError>
}) {
  return {
    id: StrategyID.make("git_worktree"),
    create: Effect.fn("ProjectCopy.GitWorktree.create")(function* (options) {
      const repository = yield* input.git.repo.discover(options.sourceDirectory)
      if (!repository) return yield* new DirectoryUnavailableError({ directory: options.sourceDirectory })
      yield* input.git.worktree.create({ repository, directory: options.directory })
      return { directory: yield* input.canonical(options.directory) }
    }),
    remove: Effect.fn("ProjectCopy.GitWorktree.remove")(function* (options) {
      const found = yield* input.git.repo.discover(options.directory)
      if (!found) return yield* new DirectoryUnavailableError({ directory: options.directory })
      yield* input.git.worktree.remove({ repository: found, directory: options.directory, force: options.force })
    }),
    list: Effect.fn("ProjectCopy.GitWorktree.list")(function* (directory) {
      const found = yield* input.git.repo.discover(directory)
      if (!found) return yield* new DirectoryUnavailableError({ directory })
      const entries = yield* input.git.worktree.list(found)
      return yield* Effect.forEach(entries, (entry) =>
        input.canonical(entry.directory).pipe(
          Effect.map((directory) => ({ directory, type: entry.kind === "main" ? "root" : "copy" }) as const),
          Effect.catchTag("ProjectCopy.DirectoryUnavailableError", () => Effect.succeed(undefined)),
        ),
      ).pipe(Effect.map((items) => items.filter((item): item is ListEntry => item !== undefined)))
    }),
  } satisfies Strategy
}
