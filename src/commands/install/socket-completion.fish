# Fish completion for socket

# Define command structure
set -l commands analytics audit-log cdxgen ci config dependencies diff-scan fix info install login logout manifest npm npx oops optimize organization package raw-npm raw-npx report repos scan threat-feed uninstall wrapper

# Define subcommands
set -l config_subcmds auto get list set unset
set -l diff_scan_subcmds get
set -l install_subcmds completion
set -l manifest_subcmds auto conda scala gradle kotlin
set -l organization_subcmds list quota policy
set -l organization_policy_subcmds license security
set -l package_subcmds score shallow
set -l report_subcmds create view
set -l repos_subcmds create view list del update
set -l scan_subcmds create list del diff metadata report view
set -l uninstall_subcmds completion

# Define flags
set -l common_flags --config --dryRun --help --version

# Helper function to get subcommands
function __socket_get_subcmds
    switch $argv[1]
        case config
            echo $config_subcmds
        case diff-scan
            echo $diff_scan_subcmds
        case install
            echo $install_subcmds
        case manifest
            echo $manifest_subcmds
        case organization
            echo $organization_subcmds
        case "organization policy"
            echo $organization_policy_subcmds
        case package
            echo $package_subcmds
        case report
            echo $report_subcmds
        case repos
            echo $repos_subcmds
        case scan
            echo $scan_subcmds
        case uninstall
            echo $uninstall_subcmds
    end
end

# Helper function to get flags
function __socket_get_flags
    switch $argv[1]
        case analytics
            echo --file --json --markdown --repo --scope --time
        case audit-log
            echo --interactive --org --page --perPage --type
        case cdxgen
            echo --api-key --author --auto-compositions --deep --evidence --exclude --exclude-type --fail-on-error --filter --generate-key-and-sign --include-crypto --include-formulation --install-deps --json-pretty --min-confidence --no-babel --only --output --parent-project-id --print --profile --project-group --project-name --project-id --project-version --recurse --required-only --resolve-class --server --server-host --server-port --server-url --skip-dt-tls-check --spec-version --standard --technique --type --validate
        case "config auto"
        case "config get"
        case "config list"
        case "config set"
        case "config unset"
            echo --json --markdown
        case dependencies
            echo --json --limit --markdown --offset
        case "diff-scan get"
            echo --after --before --depth --file --json
        case fix
            echo --autoMerge --autopilot --limit --purl --rangeStyle --test --testScript
        case info
            echo --all --strict
        case login
            echo --apiBaseUrl --apiProxy
        case "manifest auto"
            echo --cwd --verbose
        case "manifest conda"
            echo --cwd --out --verbose
        case "manifest gradle"
            echo --bin --cwd --gradleOpts --task --verbose
        case "manifest kotlin"
            echo --bin --cwd --gradleOpts --task --verbose
        case "manifest scala"
            echo --bin --cwd --out --sbtOpts --stdout --verbose
        case optimize
            echo --pin --prod
        case "organization policy license"
        case "organization policy security"
            echo --interactive --org
        case "package score"
        case "package shallow"
            echo --json --markdown
        case "repos create"
            echo --defaultBranch --homepage --interactive --org --repoDescription --repoName --visibility
        case "repos del"
            echo --interactive --org
        case "repos list"
            echo --direction --interactive --org --page --perPage --sort
        case "repos update"
            echo --defaultBranch --homepage --interactive --org --repoDescription --repoName --visibility
        case "repos view"
            echo --interactive --org --repoName
        case "scan create"
            echo --branch --commitHash --commitMessage --committers --cwd --defaultBranch --interactive --org --pendingHead --pullRequest --readOnly --repo --report --tmp
        case "scan del"
            echo --interactive --org
        case "scan diff"
            echo --depth --file --interactive --org
        case "scan list"
            echo --branch --direction --fromTime --interactive --org --page --perPage --repo --sort --untilTime
        case "scan metadata"
            echo --interactive --org
        case "scan report"
            echo --fold --interactive --license --org --reportLevel --short
        case "scan view"
            echo --interactive --org --stream
        case threat-feed
            echo --direction --eco --filter --interactive --json --markdown --org --page --perPage
        case wrapper
            echo --disable --enable
    end
end

# Main completion function
complete -c socket -c sd -f

# Top level commands and flags
complete -c socket -c sd -n __fish_use_subcommand -a "$commands"
complete -c socket -c sd -n __fish_use_subcommand -l config -l dryRun -l help -l version

# Subcommand completions
for cmd in $commands
    set -l subcmds (__socket_get_subcmds $cmd)
    if test -n "$subcmds"
        complete -c socket -c sd -n "__fish_seen_subcommand_from $cmd" -a "$subcmds"
    end
end

# Special case for organization policy
complete -c socket -c sd -n "__fish_seen_subcommand_from organization policy" -a "$organization_policy_subcmds"

# Flag completions
for cmd in $commands
    set -l flags (__socket_get_flags $cmd)
    if test -n "$flags"
        complete -c socket -c sd -n "__fish_seen_subcommand_from $cmd" $flags
    end
end

# Flag completions for subcommands
for cmd in $commands
    set -l subcmds (__socket_get_subcmds $cmd)
    for subcmd in $subcmds
        set -l flags (__socket_get_flags "$cmd $subcmd")
        if test -n "$flags"
            complete -c socket -c sd -n "__fish_seen_subcommand_from $cmd $subcmd" $flags
        end
    end
end

# Special case for organization policy subcommands
for subcmd in $organization_policy_subcmds
    set -l flags (__socket_get_flags "organization policy $subcmd")
    if test -n "$flags"
        complete -c socket -c sd -n "__fish_seen_subcommand_from organization policy $subcmd" $flags
    end
end 