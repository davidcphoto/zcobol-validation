# Change Log

All notable changes to the "zcobol-validation" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.0] - 2026-03-11

### Added
- **Unused Variables Detection**: Identifies variables declared in WORKING-STORAGE or LINKAGE SECTION that are not used in the code
  - Quick Fixes: Delete line or comment with asterisk

- **Unprotected Display Validation**: Detects DISPLAY commands outside IF blocks
  - Quick Fixes: Wrap with IF...END-IF, comment or delete line

- **GO TO Command Detection**: Warns about GO TO usage, suggesting PERFORM refactoring
  - Quick Fixes: Comment or delete line

- **IF without END-IF Validation**: Detects IF blocks missing matching END-IF
  - Quick Fix: Automatically add END-IF

- **IF without ELSE Validation** (optional, disabled by default): Identifies IF blocks without ELSE clause
  - Quick Fixes: Add ELSE or ELSE with CONTINUE

- **EVALUATE without WHEN OTHER Validation** (optional, disabled by default): Detects EVALUATE blocks without WHEN OTHER clause
  - Quick Fixes: Add WHEN OTHER or WHEN OTHER with CONTINUE

- **Symbolic Operators Detection**: Identifies use of symbols (<, >, =, <=, >=, <>) in conditions, suggesting COBOL keywords
  - Quick Fix: Automatically replace with LESS THAN, GREATER THAN, EQUAL, etc.
  - Configurable: Long or short format

- **Hardcoded Values Detection**: Detects string and number literals in code
  - Quick Fix: Create constant automatically in WORKING-STORAGE
  - Configurable: Enable/disable in STRING, DISPLAY commands
  - Smart constant naming with prefix customization
  - Detects existing constants to avoid duplication

- **Lowercase Code Detection** (optional, disabled by default): Identifies lowercase code (COBOL should be uppercase)
  - Quick Fix: Convert to uppercase

- **File Operations Validation**: Checks if declared files (SELECT) have all necessary operations
  - Validates presence of: OPEN, CLOSE, READ or WRITE

- **Cursor Operations Validation**: Checks if declared SQL cursors have all necessary operations
  - Validates presence of: OPEN, FETCH, CLOSE
  - Supports multi-line EXEC SQL...END-EXEC blocks

### Features
- Configurable settings for all validations (enable/disable individually)
- Customizable operator format (long/short)
- Customizable constant prefix
- Default IF condition setting
- Comprehensive Quick Fix actions for all validations
- Group variable detection (ignores group-level variables in unused variable check)
- Multi-line statement support
- Proper COBOL column handling (respects column 7 for comments)

### User Interface
- Extension icon with Z letter and check mark
- English language support for all messages and documentation