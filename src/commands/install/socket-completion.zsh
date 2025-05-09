#compdef socket sd

# Define command structure
typeset -A _socket_commands
_socket_commands=(
    analytics ""
    audit-log ""
    cdxgen ""
    ci ""
    config "auto get list set unset"
    dependencies ""
    diff-scan "get"
    fix ""
    info ""
    install "completion"
    login ""
    logout ""
    manifest "auto conda scala gradle kotlin"
    npm ""
    npx ""
    oops ""
    optimize ""
    organization "list quota policy"
    package "score shallow"
    raw-npm ""
    raw-npx ""
    report "create view"
    repos "create view list del update"
    scan "create list del diff metadata report view"
    threat-feed ""
    uninstall "completion"
    wrapper ""
)

# Define flags
typeset -A _socket_flags
_socket_flags=(
    common "--config --dryRun --help --version"
    analytics "--file --json --markdown --repo --scope --time"
    audit-log "--interactive --org --page --perPage --type"
    cdxgen "--api-key --author --auto-compositions --deep --evidence --exclude --exclude-type --fail-on-error --filter --generate-key-and-sign --include-crypto --include-formulation --install-deps --json-pretty --min-confidence --no-babel --only --output --parent-project-id --print --profile --project-group --project-name --project-id --project-version --recurse --required-only --resolve-class --server --server-host --server-port --server-url --skip-dt-tls-check --spec-version --standard --technique --type --validate"
    ci ""
    "config auto" "--json --markdown"
    "config get" "--json --markdown"
    "config list" "--full --json --markdown"
    "config set" "--json --markdown"
    "config unset" "--json --markdown"
    dependencies "--json --limit --markdown --offset"
    "diff-scan get" "--after --before --depth --file --json"
    fix "--autoMerge --autopilot --limit --purl --rangeStyle --test --testScript"
    info "--all --strict"
    "install completion" ""
    login "--apiBaseUrl --apiProxy"
    "manifest auto" "--cwd --verbose"
    "manifest conda" "--cwd --out --verbose"
    "manifest gradle" "--bin --cwd --gradleOpts --task --verbose"
    "manifest kotlin" "--bin --cwd --gradleOpts --task --verbose"
    "manifest scala" "--bin --cwd --out --sbtOpts --stdout --verbose"
    npm ""
    npx ""
    oops ""
    optimize "--pin --prod"
    "organization list" ""
    "organization policy license" "--interactive --org"
    "organization policy security" "--interactive --org"
    "organization quota" ""
    "package score" "--json --markdown"
    "package shallow" "--json --markdown"
    raw-npm ""
    raw-npx ""
    "repos create" "--defaultBranch --homepage --interactive --org --repoDescription --repoName --visibility"
    "repos del" "--interactive --org"
    "repos list" "--direction --interactive --org --page --perPage --sort"
    "repos update" "--defaultBranch --homepage --interactive --org --repoDescription --repoName --visibility"
    "repos view" "--interactive --org --repoName"
    "scan create" "--branch --commitHash --commitMessage --committers --cwd --defaultBranch --interactive --org --pendingHead --pullRequest --readOnly --repo --report --tmp"
    "scan del" "--interactive --org"
    "scan diff" "--depth --file --interactive --org"
    "scan list" "--branch --direction --fromTime --interactive --org --page --perPage --repo --sort --untilTime"
    "scan metadata" "--interactive --org"
    "scan report" "--fold --interactive --license --org --reportLevel --short"
    "scan view" "--interactive --org --stream"
    threat-feed "--direction --eco --filter --interactive --json --markdown --org --page --perPage"
    "uninstall completion" ""
    wrapper "--disable --enable"
)

# Helper function to get subcommands
_socket_subcommands() {
    local cmd="$1"
    echo ${=_socket_commands[$cmd]}
}

# Helper function to get flags
_socket_flags() {
    local cmd="$1"
    echo ${=_socket_flags[common]} ${=_socket_flags[$cmd]}
}

# Main completion function
_socket() {
    local curcontext="$curcontext" state line
    typeset -A opt_args

    _arguments -C \
        '*:: :->subcmds' && return 0

    if (( CURRENT == 1 )); then
        # First level - show top-level commands and common flags
        _arguments \
            ${=_socket_flags[common]} \
            '*:: :->subcmds'
        _values 'socket commands' ${(k)_socket_commands}
        return
    fi

    # Build command path
    local cmd_path=""
    for ((i=1; i<CURRENT; i++)); do
        if [ -z "$cmd_path" ]; then
            cmd_path="${words[$i]}"
        else
            cmd_path="$cmd_path ${words[$i]}"
        fi
    done

    # Get subcommands for current level
    local subcmds=$(_socket_subcommands "$cmd_path")
    if [ -n "$subcmds" ]; then
        _values "socket $cmd_path subcommands" ${=subcmds}
        return
    fi

    # If no subcommands, show flags
    _arguments ${=_socket_flags[$cmd_path]}
}

compdef _socket socket sd 