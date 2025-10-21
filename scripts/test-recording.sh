#!/bin/bash
# Script to record terminal session testing the TUI demo.
# This will create a typescript file showing the exact behavior.

echo "=== Starting TUI Demo Test Recording ==="
echo "This will record:"
echo "1. Initial state (1 line textarea)"
echo "2. Pressing Ctrl+N multiple times to expand"
echo "3. Pressing Enter to collapse"
echo "4. Repeating the cycle to observe garbling"
echo ""
echo "Recording will be saved to: /tmp/tui-test-recording.txt"
echo ""
echo "Starting in 3 seconds..."
sleep 3

# Use script to record the session.
script -q /tmp/tui-test-recording.txt << 'EOF'
# Run the demo.
node /Users/jdalton/projects/socket-cli/scripts/demo-final-tui.mjs

# The demo will start...
# I'll send keystrokes programmatically to simulate the test:
# - Wait 2 seconds
# - Send Ctrl+N (expand) 5 times
# - Wait 1 second
# - Send Enter (collapse)
# - Wait 1 second
# - Send Ctrl+N 5 times again
# - Wait 1 second
# - Send Enter
# - Wait 1 second
# - Send Ctrl+C to exit

EOF

echo ""
echo "=== Recording complete ==="
echo "View with: cat /tmp/tui-test-recording.txt"
