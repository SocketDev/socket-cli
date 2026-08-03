// @file Re-exports the fleet's positional-argument parser from
//   @socketsecurity/lib/shell/command-args so every hook that imports this
//   module keeps working unchanged. See that module's doc comment for the
//   value-flag rationale.
export {
  GH_VALUE_FLAGS,
  GIT_VALUE_FLAGS,
  NPM_VALUE_FLAGS,
  positionalArgs,
} from '@socketsecurity/lib-stable/shell/command-args'
