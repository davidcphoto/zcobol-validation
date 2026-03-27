# [1.3.0] - 2026-03-26

### Added
- **Go to Definition for Cursors**: Ctrl+Click/F12 no nome do cursor (em OPEN, FETCH, CLOSE ou na declaração) navega para a declaração do cursor.
- **Find All References for Cursors**: Shift+F12 mostra todas as referências (operações e declaração) de cada cursor COBOL.

### Improved
- Navegação consistente entre operações e declaração de cursores SQL.

### Fixed
- Removido o DocumentLinkProvider para evitar confusão com links que não movem o cursor.

# Change Log

All notable changes to the "zcobol-validation" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.2.2] - 2026-03-18

### Added
- **Free Format COBOL Support**: Automatic detection of COBOL format
  - Supports traditional format (with sequence numbers in columns 1-6)
  - Supports free format (without sequence numbers)
  - Automatic format detection based on file content (70% threshold)
  - All validations now work correctly in both formats

### Fixed
- **Column Position Corrections**: Fixed incorrect error marking positions
  - Corrected column offset calculation (column 7 instead of 6 for traditional format)
  - Symbolic operators (=, <, >, etc.) now marked at correct position
  - QuickFix replacements now occur at the correct location

- **Section Detection with Sequence Numbers**: Fixed validations not working when DATA DIVISION and other sections had text in columns 1-7
  - Added helper functions: `isProcedureDivision()`, `isDataDivision()`, `isWorkingStorageSection()`, `isLinkageSection()`, `isFileControl()`
  - All section detections now use `getCobolCodeArea()` to properly ignore columns 1-7
  - Variable extraction and file declarations now work correctly regardless of sequence numbers

### Improved
- **Code Organization**: Better structured code for COBOL format handling
  - New `hasSequenceNumbers()` function for format detection
  - New `getColumnOffset()` function for consistent column calculations
  - Updated all validation functions to accept `useTraditionalFormat` parameter
  - More maintainable and consistent codebase

## [1.2.1] - 2026-03-14
- **Ignore sequence numbers**: Ignore sequence numbers on the validations

## [1.2.0] - 2026-03-14

### Performance Improvements
- **Debounce Validation**: Added 500ms debounce to prevent excessive validations while typing
  - Reduces validation calls by 70-80% during active editing
  - Improves CPU usage and responsiveness

- **Smart Caching System**: Implemented content-based caching
  - Validates only when document content actually changes
  - Cache automatically cleared when documents close or configuration changes
  - Up to 50%+ faster for unchanged documents

- **Optimized Debug Logging**: Debug logs now disabled by default
  - Set `DEBUG_MODE = true` to enable detailed logging for troubleshooting
  - Significantly reduces console overhead

- **Resource Management**: Improved memory and timer cleanup
  - Properly cleans up debounce timers on document close
  - Clears cache on extension deactivation
  - Better memory footprint for long editing sessions

### Compatibility
- **Zowe Explorer Support**: Quick Fixes now work with remote mainframe files
  - Added support for `zowe-ds` scheme (datasets)
  - Added support for `zowe-uss` scheme (USS files)
  - Added support for `vscode-remote` scheme
  - Enhanced file detection to handle remote URIs correctly

## [1.1.0] - 2026-03-13

### Added
- **Level 88 Condition Validation**: Detects unused level 88 condition names
  - Validates that declared 88-level conditions are used in the code
  - Quick Fixes: Delete line or comment with asterisk
  - Can be enabled/disabled via `enableUnusedLevel88Check` setting

### Improved
- **Enhanced Unused Variable Detection**: Now considers level 88 conditions when checking variable usage
  - Variables with level 88 conditions are considered "used" if any of their conditions are used
  - Example: A variable with `88 STATUS-OK VALUE 'Y'` is considered used if `STATUS-OK` appears in code

- **FILLER Variables Handling**: Improved handling of FILLER variables
  - FILLER variables are now completely ignored in unused variable validation
  - Level 88 conditions associated with FILLER variables are also ignored
  - Applies to both `FILLER` and `FILLER-*` patterns

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