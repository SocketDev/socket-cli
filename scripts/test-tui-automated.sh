#!/bin/bash
# Automated TUI test script that can be recorded.
# This sends keystrokes to the demo to demonstrate the fix.

echo "=== TUI Demo Test - Automated ==="
echo ""
echo "This will demonstrate:"
echo "  1. Initial state (1 line textarea)"
echo "  2. Expand textarea (Ctrl+N x5)"
echo "  3. Collapse textarea (Enter)"
echo "  4. Repeat cycle"
echo ""
echo "Starting demo in 2 seconds..."
sleep 2

# Create a FIFO to send commands.
FIFO="/tmp/tui-test-fifo-$$"
mkfifo "$FIFO"

# Start the demo in the background, reading from the FIFO.
node scripts/load.mjs demo-final-tui < "$FIFO" &
DEMO_PID=$!

# Give it time to initialize.
sleep 2

# Function to send keys to the FIFO.
send_key() {
  printf "$1" > "$FIFO"
}

# Test sequence.
echo "[TEST] Expanding textarea with Ctrl+N (5 times)..."
for i in {1..5}; do
  send_key $'\x0E'  # Ctrl+N
  sleep 0.3
done

sleep 1
echo "[TEST] Collapsing with Enter..."
send_key $'\r'  # Enter
sleep 1

echo "[TEST] Expanding again with Ctrl+N (5 times)..."
for i in {1..5}; do
  send_key $'\x0E'  # Ctrl+N
  sleep 0.3
done

sleep 1
echo "[TEST] Collapsing with Enter..."
send_key $'\r'  # Enter
sleep 1

echo "[TEST] One more expand cycle..."
for i in {1..5}; do
  send_key $'\x0E'  # Ctrl+N
  sleep 0.3
done

sleep 1
echo "[TEST] Final collapse..."
send_key $'\r'  # Enter
sleep 2

echo "[TEST] Exiting with q..."
send_key 'q'
sleep 1

# Cleanup.
rm -f "$FIFO"
wait "$DEMO_PID" 2>/dev/null || true

echo ""
echo "=== Test Complete ==="
