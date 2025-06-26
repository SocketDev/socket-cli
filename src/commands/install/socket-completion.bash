#!/usr/bin/env bash

# Declare associative arrays
declare -A COMMANDS
declare -A FLAGS

# Define command structure with nested subcommands
COMMANDS=(
    [analytics]=""
    [audit-log]=""
    [cdxgen]=""
    [ci]=""
    [config]="auto get list set unset"
    [config auto]=""
    [config get]=""
    [config list]=""
    [config set]=""
    [config unset]=""
    [dependencies]=""
    [diff-scan]="get"
    [diff-scan get]=""
    [fix]=""
    [info]=""
    [install]="completion"
    [install completion]=""
    [login]=""
    [logout]=""
    [manifest]="auto cdxgen conda scala gradle kotlin"
    [manifest auto]=""
    [manifest conda]=""
    [manifest cdxgen]=""
    [manifest gradle]=""
    [manifest kotlin]=""
    [manifest scala]=""
    [manifest setup]=""
    [npm]=""
    [npx]=""
    [oops]=""
    [optimize]=""
    [organization]="list quota policy"
    [organization list]=""
    [organization policy]="license security"
    [organization policy license]=""
    [organization policy security]=""
    [organization quota]=""
    [package]="score shallow"
    [package score]=""
    [package shallow]=""
    [raw-npm]=""
    [raw-npx]=""
    [report]="create view"
    [report create]=""
    [report view]=""
    [repos]="create view list del update"
    [repos create]=""
    [repos del]=""
    [repos list]=""
    [repos update]=""
    [repos view]=""
    [scan]="create list del diff metadata report view"
    [scan create]=""
    [scan del]=""
    [scan diff]=""
    [scan list]=""
    [scan metadata]=""
    [scan reach]=""
    [scan report]=""
    [scan view]=""
    [threat-feed]=""
    [uninstall]="completion"
    [uninstall completion]=""
    [wrapper]=""
)

# Define flags
FLAGS=(
    [common]="--config --dryRun --help --version"
    [analytics]="--file --json --markdown --repo --scope --time"
    [audit-log]="--interactive --org --page --perPage --type"
    [cdxgen]="--api-key --author --auto-compositions --deep --evidence --exclude --exclude-type --fail-on-error --filter --generate-key-and-sign --include-crypto --include-formulation --install-deps --json-pretty --min-confidence --no-babel --only --output --parent-project-id --print --profile --project-group --project-name --project-id --project-version --recurse --required-only --resolve-class --server --server-host --server-port --server-url --skip-dt-tls-check --spec-version --standard --technique --type --validate"
    [ci]="--autoManifest"
    [config]=""
    [config auto]="--json --markdown"
    [config get]="--json --markdown"
    [config list]="--full --json --markdown"
    [config set]="--json --markdown"
    [config unset]="--json --markdown"
    [dependencies]="--json --limit --markdown --offset"
    [diff-scan]=""
    [diff-scan get]="--after --before --depth --file --json"
    [fix]="--autoMerge --autopilot --ghsa --limit --purl --rangeStyle --test --testScript"
    [info]="--all --strict"
    [install]=""
    [install completion]=""
    [login]="--apiBaseUrl --apiProxy"
    [logout]=""
    [manifest]=""
    [manifest auto]="--cwd --verbose"
    [manifest conda]="--file --stdin --out --stdout --verbose"
    [manifest cdxgen]="--api-key --author --auto-compositions --deep --evidence --exclude --exclude-type --fail-on-error --filter --generate-key-and-sign --include-crypto --include-formulation --install-deps --json-pretty --min-confidence --no-babel --only --output --parent-project-id --print --profile --project-group --project-name --project-id --project-version --recurse --required-only --resolve-class --server --server-host --server-port --server-url --skip-dt-tls-check --spec-version --standard --technique --type --validate"
    [manifest gradle]="--bin --gradleOpts --verbose"
    [manifest kotlin]="--bin --gradleOpts --verbose"
    [manifest scala]="--bin --out --sbtOpts --stdout --verbose"
    [manifest setup]="--cwd --defaultOnReadError"
    [npm]=""
    [npx]=""
    [oops]=""
    [optimize]="--pin --prod"
    [organization]=""
    [organization list]=""
    [organization policy]=""
    [organization policy license]="--interactive --org"
    [organization policy security]="--interactive --org"
    [organization quota]=""
    [package]=""
    [package score]="--json --markdown"
    [package shallow]="--json --markdown"
    [raw-npm]=""
    [raw-npx]=""
    [report]=""
    [report create]=""
    [report view]=""
    [repos]=""
    [repos create]="--defaultBranch --homepage --interactive --org --repoDescription --repoName --visibility"
    [repos del]="--interactive --org"
    [repos list]="--all --direction --interactive --org --page --perPage --sort"
    [repos update]="--defaultBranch --homepage --interactive --org --repoDescription --repoName --visibility"
    [repos view]="--interactive --org --repoName"
    [scan]=""
    [scan create]="--autoManifest --branch --commitHash --commitMessage --committers --cwd --defaultBranch --interactive --org --pullRequest --readOnly --repo --report --setAsAlertsPage --tmp"
    [scan del]="--interactive --org"
    [scan diff]="--depth --file --interactive --org"
    [scan list]="--branch --direction --fromTime --interactive --org --page --perPage --repo --sort --untilTime"
    [scan metadata]="--interactive --org"
    [scan reach]=""
    [scan report]="--fold --interactive --license --org --reportLevel --short"
    [scan view]="--interactive --org --stream"
    [threat-feed]="--direction --eco --filter --interactive --json --markdown --org --page --perPage"
    [uninstall]=""
    [uninstall completion]=""
    [wrapper]="--disable --enable"
)

_socket_completion_version() {
  echo "%SOCKET_VERSION_TOKEN%" # replaced when installing
}

_socket_completion() {
    local cur prev words cword
    _init_completion || return

    # If we're at the start of a flag, show appropriate flags
    if [[ "$cur" == -* ]]; then
        # Get unique top-level commands
        local top_commands=""
        for cmd in "${!COMMANDS[@]}"; do
            # Get first word of the command
            local first_word=${cmd%% *}
            # Only add if not already in top_commands
            if [[ ! $top_commands =~ (^|[[:space:]])$first_word($|[[:space:]]) ]]; then
                top_commands="$top_commands $first_word"
            fi
        done

        # If we're at the first word, show common flags
        if [ "$cword" -eq 1 ]; then
            COMPREPLY=( $(compgen -W "${FLAGS[common]}" -- "$cur") )
            return 0
        fi

        # Build the command path up to the current word
        local cmd_path=""
        for ((i=1; i<cword; i++)); do
            if [ -z "$cmd_path" ]; then
                cmd_path="${words[$i]}"
            else
                cmd_path="$cmd_path ${words[$i]}"
            fi
        done

        local flags="${FLAGS[common]} ${FLAGS[$cmd_path]}"
        COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
        return 0
    fi

    # Get unique top-level commands
    local top_commands=""
    for cmd in "${!COMMANDS[@]}"; do
        # Get first word of the command
        local first_word=${cmd%% *}
        # Only add if not already in top_commands
        if [[ ! $top_commands =~ (^|[[:space:]])$first_word($|[[:space:]]) ]]; then
            top_commands="$top_commands $first_word"
        fi
    done

    # If we're at the first word, show top-level commands
    if [ "$cword" -eq 1 ]; then
        COMPREPLY=( $(compgen -W "$top_commands" -- "$cur") )
        return 0
    fi

    # Build the command path up to the current word
    local cmd_path=""
    for ((i=1; i<cword; i++)); do
        if [ -z "$cmd_path" ]; then
            cmd_path="${words[$i]}"
        else
            cmd_path="$cmd_path ${words[$i]}"
        fi
    done

    # Check for subcommands at the current level
    local subcmds="${COMMANDS[$cmd_path]:-}"
    if [ -n "$subcmds" ]; then
        COMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )
        return 0
    fi

    # We did not find any deeper subcommands so show flags
    local flags="${FLAGS[common]} ${FLAGS[$cmd_path]}"
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
    return 0
}

# Register the completion function
# This script defines the `_socket_completion` function which provides tab
# completion for the Socket CLI. To use this completion:
#
# 1. Source this script in your current shell:
#    source /path/to/socket-completion.bash
#
# 2. Add the following to your ~/.bashrc to enable completion in new shells:
#    if [ -f /path/to/socket-completion.bash ]; then
#        source /path/to/socket-completion.bash
#        complete -F _socket_completion socket
#        complete -F _socket_completion ./sd
#        etc, must repeat for any alias you want it
#    fi
