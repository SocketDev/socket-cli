#!/usr/bin/env node
/**
 * @fileoverview Thin entry shim — real CLI lives in ai-lint-fix/cli.mts.
 *
 * Rule data (AI_HANDLED_RULES + RULE_GUIDANCE) lives in
 * ai-lint-fix/rule-guidance.mts so the prompt corpus can be reviewed /
 * extended without touching the orchestrator.
 */

import './ai-lint-fix/cli.mts'
