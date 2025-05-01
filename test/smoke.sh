#!/bin/bash

##### Smoke test
## Usage:
##
##    ./test/smoke [subcommand]
##
## Example:
##
##    ./test/smoke
##    ./test/smoke scan
##
######


# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
WHITE_BG='\033[47m'
BLACK_FG='\033[30m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Initialize counters and arrays
PASSED=0
FAILED=0
FAILED_TESTS=()
TEST_COUNTER=0

# node 20 or anything
# COMMAND_PREFIX="npm run --silent s --"
# node 22+
COMMAND_PREFIX="./sd"

# Get target subcommand from first argument
TARGET_SUBCOMMAND="$1"

# Function to check if a section should be run
should_run_section() {
    local section="$1"
    if [ -z "$TARGET_SUBCOMMAND" ]; then
        return 0  # Run all sections if no subcommand specified
    fi
    if [ "$section" = "$TARGET_SUBCOMMAND" ]; then
        return 0
    fi
    return 1
}

# Function to check git status
check_git_status() {
    if [ -d .git ]; then
        if [ -n "$(git status --porcelain)" ]; then
            echo -e "${YELLOW}Warning: Git repository is not clean${NC}"
            git status --porcelain
            echo -e "\n${YELLOW}Running tests may modify files. Continue? [y/N]${NC}"
            read -r response
            if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
                echo "Aborting..."
                exit 1
            fi
        else
            echo -e "${GREEN}Git repository is clean${NC}"
        fi
    else
        echo -e "${YELLOW}Not a git repository${NC}"
    fi
}

# Function to validate JSON
validate_json() {
    local json_output
    local expected_exit="$1"
    json_output=$(cat)  # Read from stdin

    # First check if it's valid JSON
    if ! echo "$json_output" | jq . > /dev/null 2>&1; then
        echo -e "${RED}✗ Invalid JSON output${NC}"
        echo -e "Received:"
        echo -e "$json_output"
        return 1
    fi

    # Check for required fields and type structure
    # type: `{ ok: true, data: unknown, message?: string } | { ok: false, data?: unknown, message: string, cause?: string, code?: number }`
    local ok_field
    local data_field
    local message_field
    local cause_field
    local code_field

    ok_field=$(echo "$json_output" | jq -r '.ok')
    data_field=$(echo "$json_output" | jq -r '.data')
    message_field=$(echo "$json_output" | jq -r '.message // empty')
    cause_field=$(echo "$json_output" | jq -r '.cause // empty')
    code_field=$(echo "$json_output" | jq -r '.code // empty')

    # Check if ok field matches expected exit code
    if [ "$expected_exit" -eq 0 ] && [ "$ok_field" != "true" ]; then
        echo -e "${RED}✗ JSON output 'ok' should be true when exit code is 0${NC}"
        echo -e "Received:"
        echo -e "$json_output"
        return 1
    fi
    if [ "$expected_exit" -ne 0 ] && [ "$ok_field" != "false" ]; then
        echo -e "${RED}✗ JSON output 'ok' should be false when exit code is non-zero${NC}"
        echo -e "Received:"
        echo -e "$json_output"
        return 1
    fi

    # Check if data field exists (required when ok is true, optional when false)
    if [ "$ok_field" = "true" ] && [ "$data_field" = "null" ]; then
        echo -e "${RED}✗ JSON output missing required 'data' field when ok is true${NC}"
        echo -e "Received:"
        echo -e "$json_output"
        return 1
    fi

    # If ok is false, message is required
    if [ "$ok_field" = "false" ] && [ -z "$message_field" ]; then
        echo -e "${RED}✗ JSON output missing required 'message' field when ok is false${NC}"
        echo -e "Received:"
        echo -e "$json_output"
        return 1
    fi

    # If code exists, it must be a number
    if [ -n "$code_field" ] && ! [[ "$code_field" =~ ^[0-9]+$ ]]; then
        echo -e "${RED}✗ JSON output 'code' field must be a number${NC}"
        echo -e "Received:"
        echo -e "$json_output"
        return 1
    fi

    return 0
}

# Function to run a test with JSON validation
run_json() {
    local expected_exit="$1"
    shift  # Remove the first argument
    local command="${COMMAND_PREFIX} $*"  # Get all remaining arguments and prepend the common prefix
    ((TEST_COUNTER++))

    echo -e "\n${WHITE_BG}${BLACK_FG}=== Test #$TEST_COUNTER ===${NC}"
    echo -e "Command: ${DIM}${COMMAND_PREFIX}${NC}${BOLD} $*${NC}"
    echo "Expected exit code: $expected_exit"

    # Run the command and capture its output
    local output
    output=$(eval "$command")
    local exit_code=$?

    if [ $exit_code -eq $expected_exit ]; then
        # Validate JSON output
        if ! echo "$output" | validate_json "$expected_exit"; then
            echo -e "${RED}✗ Test #$TEST_COUNTER failed (invalid JSON)${NC}   ${DIM}Command: $command${NC}"
            ((FAILED++))
            FAILED_TESTS+=("$TEST_COUNTER|$command|$expected_exit|$exit_code|invalid_json")
            return
        fi
        echo -e "${GREEN}✓ Test #$TEST_COUNTER passed${NC}   ${DIM}Command: $command${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ Test #$TEST_COUNTER failed${NC}   ${DIM}Command: $command${NC}"
        echo "Expected exit code: $expected_exit, got: $exit_code"
        ((FAILED++))
        # Store failed test details
        FAILED_TESTS+=("$TEST_COUNTER|$command|$expected_exit|$exit_code")
    fi
}

# Function to run a test
run_socket() {
    local expected_exit="$1"
    shift  # Remove the first argument
    local command="${COMMAND_PREFIX} $*"  # Get all remaining arguments and prepend the common prefix
    ((TEST_COUNTER++))

    echo -e "\n${WHITE_BG}${BLACK_FG}=== Test #$TEST_COUNTER ===${NC}"
    echo -e "Command: ${DIM}${COMMAND_PREFIX}${NC}${BOLD} $*${NC}"
    echo "Expected exit code: $expected_exit"

    # Run the command and capture its exit code
    eval "$command"
    local exit_code=$?

    if [ $exit_code -eq $expected_exit ]; then
        echo -e "${GREEN}✓ Test #$TEST_COUNTER passed${NC}   ${DIM}Command: $command${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ Test #$TEST_COUNTER failed${NC}   ${DIM}Command: $command${NC}"
        echo "Expected exit code: $expected_exit, got: $exit_code"
        ((FAILED++))
        # Store failed test details
        FAILED_TESTS+=("$TEST_COUNTER|$command|$expected_exit|$exit_code")
    fi
}

# Function to print test summary
print_test_summary() {
    echo -e "\n=== Test Summary ==="
    echo -e "${GREEN}Passed: $PASSED${NC}"
    echo -e "${RED}Failed: $FAILED${NC}"
    echo -e "Total: $((PASSED + FAILED))"

    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
    else
        echo -e "\n${RED}Failed Tests:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            IFS='|' read -r test_id command expected actual reason <<< "$test"
            echo -e "\n${RED}✗ Test #$test_id${NC}"
            echo "Command: $command"
            echo "Expected exit code: $expected"
            echo "Actual exit code:   $actual"
            if [ -n "$reason" ]; then
                echo "Reason:            $reason"
            fi
        done
    fi
}

## Check git status before proceeding
#check_git_status

## Initialize

if [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]; then
  # In node < v22 we need to run through npm, so we must build it first.
  # ./sd will use the built result through `npm run s`.
  npm run bs
else
  # We do still need some stuff built, apparently
  npm run build
fi

### Analytics

if should_run_section "analytics"; then
    run_socket 2 analytics --help
    run_socket 0 analytics --dry-run
    run_socket 0 analytics                    # interactive
    run_socket 0 analytics --markdown
    run_json   0 analytics --json
    run_socket 0 analytics org --json
    run_json   0 analytics repo socket-cli --json
    run_socket 0 analytics org 7 --markdown
    run_socket 0 analytics repo socket-cli 30 --markdown
    run_json   0 analytics 90 --json
    run_socket 0 analytics --file smoke.txt --json
    run_socket 0 analytics --file smoke.txt --markdown
    run_socket 0 analytics --file - --json

    run_socket 2 analytics --whatnow
    run_socket 2 analytics --file smoke.txt
    run_socket 2 analytics rainbow --json
    run_socket 1 analytics repo veryunknownrepo --json
    run_socket 2 analytics repo 30 --markdown
    run_socket 2 analytics org 25 --markdown
    run_socket 2 analytics 123 --json
fi

### audit-log

if should_run_section "audit-log"; then
    run_socket 2 audit-log --help
    run_socket 0 audit-log --dry-run
    run_socket 0 audit-log
fi

### cdxgen

if should_run_section "cdxgen"; then
    run_socket 0 cdxgen --help
    run_socket 2 cdxgen --dry-run
    run_socket 1 cdxgen
fi

### ci

if should_run_section "ci"; then
    run_socket 2 ci --help
    run_socket 0 ci --dry-run
    run_socket 0 ci
fi

### config

if should_run_section "config"; then
    DEFORG_BAK=$(eval "$COMMAND_PREFIX config get defaultOrg --json" | jq -r '.data' )

    run_socket 2 config
    run_socket 2 config --help
    run_socket 0 config --dry-run
    run_socket 2 config get --help
    run_socket 2 config get --dry-run
    run_socket 0 config get defaultOrg
    run_socket 2 config set --help
    run_socket 2 config set --dry-run
    run_socket 0 config set defaultOrg mydev
    run_socket 2 config unset --help
    run_socket 2 config unset --dry-run
    run_socket 0 config unset defaultOrg
    run_socket 2 config auto --help
    run_socket 2 config auto --dry-run
    run_socket 0 config auto defaultOrg

    echo "Restoring default org to $DEFORG_BAK"
    eval "${COMMAND_PREFIX} config set defaultOrg $DEFORG_BAK"
fi

### dependencies

if should_run_section "dependencies"; then
    run_socket 0 dependencies
    run_socket 2 dependencies --help
    run_socket 0 dependencies --dry-run
    run_json   0 dependencies --json
    run_socket 0 dependencies --markdown

    run_socket 0 dependencies --limit 1
    run_socket 0 dependencies --offset 5
    run_socket 0 dependencies --limit 1 --offset 10

    run_json   2 dependencies --json --wat foo
    run_json   0 dependencies --json --limit -200
    run_json   0 dependencies --json --limit NaN
    run_json   0 dependencies --json --limit foo
fi

### fix

if should_run_section "fix"; then
    run_socket 0 fix
    run_socket 2 fix --help
    run_socket 0 fix --dry-run
fi

### login

if should_run_section "login"; then
    TOKEN_BAK=$(eval "$COMMAND_PREFIX config get apiToken --json" | jq -r '.data' )

    run_socket 0 login
    run_socket 2 login --help
    run_socket 0 login --dry-run

    run_socket 1 login --wat
    run_socket 1 login --api-base-url fail
    run_socket 1 login --api-proxy fail
fi

### logout

if should_run_section "logout"; then
    run_socket 0 logout
    run_socket 2 logout --help
    run_socket 0 logout --dry-run
    run_socket 0 logout --wat

    # Let's hope this command isn't broken (:
    eval "${COMMAND_PREFIX} config set apiToken ${TOKEN_BAK}"
fi

### manifest

if should_run_section "manifest"; then
    run_socket 2 manifest
    run_socket 2 manifest --help
    run_socket 0 manifest --dry-run
    run_socket 2 manifest auto
    run_socket 2 manifest auto --help
    run_socket 0 manifest auto --dry-run
    run_socket 2 manifest conda
    run_socket 2 manifest conda --help
    run_socket 2 manifest conda --dry-run
    run_socket 2 manifest gradle
    run_socket 2 manifest gradle --help
    run_socket 2 manifest gradle --dry-run
    run_socket 2 manifest kotlin
    run_socket 2 manifest kotlin --help
    run_socket 2 manifest kotlin --dry-run
    run_socket 2 manifest scala
    run_socket 2 manifest scala --help
    run_socket 2 manifest scala --dry-run
fi

### npm

if should_run_section "npm"; then
    run_socket 1 npm
    run_socket 2 npm --help
    run_socket 0 npm --dry-run
    run_socket 0 npm info
fi

### npx

if should_run_section "npx"; then
    run_socket 2 npx
    run_socket 2 npx --help
    run_socket 0 npx --dry-run
    run_socket 0 npx socket --dry-run
fi

### oops

if should_run_section "oops"; then
    run_socket 1 oops
    run_socket 2 oops --help
    run_socket 0 oops --dry-run
    run_socket 0 oops --wat
fi

### optimize

if should_run_section "optimize"; then
    run_socket 0 optimize
    run_socket 2 optimize --help
    run_socket 0 optimize --dry-run
fi

### organization

if should_run_section "organization"; then
    run_socket 0 organization
    run_socket 2 organization --help
    run_socket 0 organization --dry-run
    run_socket 0 organization list
    run_socket 2 organization list --help
    run_socket 0 organization list --dry-run
    run_socket 2 organization policy
    run_socket 2 organization policy --help
    run_socket 0 organization policy --dry-run
    run_socket 0 organization policy license
    run_socket 2 organization policy license --help
    run_socket 0 organization policy license --dry-run
    run_socket 0 organization policy security
    run_socket 2 organization policy security --help
    run_socket 0 organization policy security --dry-run
    run_socket 0 organization quota
    run_socket 2 organization quota --help
    run_socket 0 organization quota --dry-run

    run_socket 0 organization policy security --markdown
    run_socket 0 organization policy security --json
    run_json   0 organization policy security --json
    run_socket 1 organization policy security --org trash
    run_socket 1 organization policy security --org trash --markdown
    run_socket 1 organization policy security --org trash --json
    run_json   1 organization policy security --org trash --json
    run_socket 0 organization policy security --org $DEFORG_BAK

    run_socket 0 organization policy license --markdown
    run_socket 0 organization policy license --json
    run_json   0 organization policy license --json
    run_socket 1 organization policy license --org trash
    run_socket 1 organization policy license --org trash --markdown
    run_socket 1 organization policy license --org trash --json
    run_json   1 organization policy license --org trash --json
    run_socket 0 organization policy license --org $DEFORG_BAK

    eval "$COMMAND_PREFIX config unset defaultOrg"
    run_json   2 organization policy security --json --no-interactive
    run_json   2 organization policy license --json --no-interactive
    echo "Restoring default org to $DEFORG_BAK"
    eval "${COMMAND_PREFIX} config set defaultOrg $DEFORG_BAK"
fi

### package

if should_run_section "package"; then
    run_socket 2 package
    run_socket 2 package --help
    run_socket 0 package --dry-run
    run_socket 2 package score --help
    run_socket 2 package score --dry-run
    run_socket 0 package score npm socket
    run_socket 2 package shallow --help
    run_socket 2 package shallow --dry-run
    run_socket 0 package shallow npm socket

    run_socket 0 package shallow npm socket # 500
    run_socket 0 package shallow npm babel # ok
    run_socket 0 package shallow npm nope # stuck?
    run_socket 0 package shallow npm mostdefinitelynotworkingletskeepitthatway # server won't report an error or 404, just won't report anything for this...

    run_socket 0 package score npm socket # 500
    run_socket 0 package score npm babel # ok
    run_socket 0 package score npm nope # stuck?
    run_socket 1 package score npm mostdefinitelynotworkingletskeepitthatway

    run_json   0 package shallow npm socket --json # 500
    run_json   0 package shallow npm babel --json # ok
    run_json   0 package shallow npm nope --json  # stuck?
    run_json   1 package shallow npm mostdefinitelynotworkingletskeepitthatway --json

    run_json   0 package score npm socket --json # 500
    run_json   0 package score npm babel --json # ok
    run_json   0 package score npm nope --json # stuck?
    run_json   1 package score npm mostdefinitelynotworkingletskeepitthatway --json
fi

### raw-npm

if should_run_section "raw-npm"; then
    run_socket 1 raw-npm
    run_socket 2 raw-npm --help
    run_socket 0 raw-npm --dry-run
    run_socket 0 raw-npm info
fi

### raw-npx

if should_run_section "raw-npx"; then
    run_socket 0 raw-npx                                    # interactive shell...
    run_socket 2 raw-npx --help
    run_socket 0 raw-npx --dry-run
    run_socket 0 rax-npx socket --dry-run
fi

### repos

if should_run_section "repos"; then
    eval "${COMMAND_PREFIX} config set apiToken ${TOKEN_BAK}"

    run_socket 2 repos
    run_socket 2 repos --help
    run_socket 0 repos --dry-run
    run_socket 2 repos create --help
    run_socket 2 repos create --dry-run
    run_socket 0 repos create cli-smoke-test
    run_socket 1 repos create '%$#'
    run_socket 1 repos create '%$#' --json
    run_socket 2 repos update --help
    run_socket 2 repos update --dry-run
    run_socket 0 repos update cli-smoke-test --homepage "socket.dev"
    run_socket 2 repos view --help
    run_socket 2 repos view --dry-run
    run_socket 0 repos view cli-smoke-test
    run_socket 2 repos del --help
    run_socket 2 repos del --dry-run
    run_socket 0 repos del cli-smoke-test

    eval "$COMMAND_PREFIX config unset defaultOrg"
    run_json   2 repos create 'cli_donotcreate' --json --no-interactive
    run_json   2 repos del 'cli_donotcreate' --json --no-interactive
    run_json   2 repos view 'cli_donotcreate' --json --no-interactive
    run_json   2 repos list --json --no-interactive
    run_json   2 repos update 'cli_donotcreate' --homepage evil --json --no-interactive
    eval "$COMMAND_PREFIX config set defaultOrg fake_org"
    run_json   1 repos create 'cli_donotcreate' --json
    run_json   1 repos del 'cli_donotcreate' --json
    run_json   1 repos view 'cli_donotcreate' --json
    run_json   1 repos list --json
    run_json   1 repos update 'cli_donotcreate' --homepage evil --json
    echo "Restoring default org to $DEFORG_BAK"
    eval "${COMMAND_PREFIX} config set defaultOrg $DEFORG_BAK"
    run_json   1 repos view 'cli_donotcreate' --json
    run_json   1 repos update 'cli_donotcreate' --homepage evil --json
fi

### scan

if should_run_section "scan"; then
    run_socket 2 scan
    run_socket 2 scan --help
    run_socket 0 scan --dry-run
    run_socket 2 scan create --help
    run_socket 2 scan create --dry-run
    run_socket 0 scan create .
    run_socket 0 scan create --json
    run_json   0 scan create . --json
    run_json   2 scan create --json --no-interactive
    run_json   0 scan create . --json --no-interactive
    run_socket 2 scan del --help
    run_socket 2 scan del --dry-run
    run_socket 0 scan list
    run_socket 2 scan list --help
    run_socket 0 scan list --dry-run
    run_json   0 scan list --json
    run_socket 0 scan list --markdown
    run_socket 2 scan view
    run_socket 2 scan view --help
    run_socket 2 scan view --dry-run
    # view the last scan of the current org
    SBOM_ID=$(eval "$COMMAND_PREFIX scan list --json" | jq -r '.data.results[0].id' )
    run_socket 0 scan view "$SBOM_ID"
    run_json   0 scan view "$SBOM_ID" --json
    run_socket 0 scan view "$SBOM_ID" --markdown
    run_socket 2 scan metadata --help
    run_socket 2 scan metadata --dry-run
    # view the metadata of the last scan of the current org
    run_socket 0 scan metadata "$SBOM_ID"
    run_json   0 scan metadata "$SBOM_ID" --json
    run_socket 0 scan metadata "$SBOM_ID" --markdown
    run_socket 2 scan report --help
    run_socket 2 scan report --dry-run
    # view the report of the last scan of the current org
    run_socket 0 scan report "$SBOM_ID"
    run_json   0 scan report "$SBOM_ID" --json
    run_socket 0 scan report "$SBOM_ID" --markdown
    run_socket 2 scan diff --help
    run_socket 2 scan diff --dry-run
    # diff on the last two scans in the current org
    SBOM_IDS=$( eval "$COMMAND_PREFIX scan list --json" | jq -r '.data.results[0,1].id' | tr '\n' ' ' )
    run_socket 0 scan diff "$SBOM_IDS"
    run_json   0 scan diff "$SBOM_IDS" --json
    run_socket 0 scan diff "$SBOM_IDS" --markdown

    run_socket 1 scan create . --org fake_org
    run_json   1 scan create . --org fake_org --json
    run_socket 1 scan view "$SBOM_ID" --org fake_org
    run_json   1 scan view "$SBOM_ID" --org fake_org --json
    run_socket 1 scan report "$SBOM_ID" --org fake_org
    run_json   1 scan report "$SBOM_ID" --org fake_org --json
    run_socket 1 scan metadata "$SBOM_ID" --org fake_org
    run_json   1 scan metadata "$SBOM_ID" --org fake_org --json
    run_socket 1 scan diff "$SBOM_ID" "$SBOM_ID" --org fake_org
    run_json   1 scan diff "$SBOM_ID" "$SBOM_ID" --org fake_org --json
    eval "$COMMAND_PREFIX config unset defaultOrg"
    run_json   2 scan create . --json --no-interactive
    run_json   2 scan view "$SBOM_ID" --json --no-interactive
    run_json   2 scan report "$SBOM_ID" --json --no-interactive
    run_json   2 scan metadata "$SBOM_ID" --json --no-interactive
    run_json   2 scan diff "$SBOM_ID" "$SBOM_ID" --json --no-interactive
    eval "$COMMAND_PREFIX config set defaultOrg fake_org"
    run_json   1 scan create . --json
    run_json   1 scan view "$SBOM_ID" --json
    run_json   1 scan report "$SBOM_ID" --json
    run_json   1 scan metadata "$SBOM_ID" --json
    run_json   1 scan diff "$SBOM_ID" "$SBOM_ID" --json
    echo "Restoring default org to $DEFORG_BAK"
    eval "${COMMAND_PREFIX} config set defaultOrg $DEFORG_BAK"
fi

### threat-feed

if should_run_section "threat-feed"; then
    # by default interactive so use flags
    run_socket 0 threat-feed                                    # potential caching issue? first run tends to show empty window with top of "window" scrolled down
    run_socket 2 threat-feed --help
    run_socket 0 threat-feed --dry-run
    run_json   0 threat-feed --json
    run_socket 0 threat-feed --markdown
    run_socket 0 threat-feed --no-interactive
fi

### wrapper

if should_run_section "wrapper"; then
    run_socket 2 wrapper
    run_socket 2 wrapper --help
    run_socket 2 wrapper --dry-run
    run_socket 0 wrapper --enable
    run_socket 0 wrapper --disable
fi

### The end

print_test_summary
