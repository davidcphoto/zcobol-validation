# zCobol Validation

Visual Studio Code extension that provides advanced validations for COBOL programs, helping maintain code quality and programming best practices.

## Features

### 🔍 Available Validations

#### 1. **Unused Variables**
Detects variables declared in WORKING-STORAGE or LINKAGE SECTION that are not used in the code.

- ✅ **Quick Fix**: Delete line or comment with asterisk
- 🎯 **Severity**: Warning
- 🔧 **Smart Detection**:
  - Considers level 88 conditions: a variable is marked as "used" if any of its 88-level conditions are used
  - Ignores FILLER and FILLER-* variables
  - Ignores group-level variables (variables without PIC that contain sub-variables)

#### 2. **Unprotected Displays**
Identifies DISPLAY commands that are not inside IF blocks.

- ✅ **Quick Fix**: Wrap with IF...END-IF, comment or delete
- 🎯 **Severity**: Warning

#### 3. **GO TO Commands**
Alerts about GO TO usage, suggesting refactoring with PERFORM.

- ✅ **Quick Fix**: Comment or delete
- 🎯 **Severity**: Warning

#### 4. **IFs without END-IF**
Detects IF blocks that don't have a matching END-IF.

- ✅ **Quick Fix**: Add END-IF automatically
- 🎯 **Severity**: Error

#### 5. **IFs without ELSE** *(Optional - disabled by default)*
Identifies IF blocks without ELSE clause.

- ✅ **Quick Fix**: Add ELSE or ELSE with CONTINUE
- 🎯 **Severity**: Warning

#### 6. **EVALUATE without WHEN OTHER** *(Optional - disabled by default)*
Detects EVALUATE blocks without WHEN OTHER clause.

- ✅ **Quick Fix**: Add WHEN OTHER or WHEN OTHER with CONTINUE
- 🎯 **Severity**: Warning

#### 7. **Symbolic Operators**
Identifies use of symbols (<, >, =, <=, >=, <>) in IF and WHEN conditions, suggesting appropriate COBOL keywords.

- ✅ **Quick Fix**: Automatically replace with LESS THAN, GREATER THAN, EQUAL, etc.
- 🎯 **Severity**: Warning
- ⚙️ **Configurable**: Long or short format

#### 8. **Hardcoded Values**
Detects string and number literals in code, suggesting constant creation.

- ✅ **Quick Fix**: Create constant automatically in WORKING-STORAGE
- 🎯 **Severity**: Warning
- ⚙️ **Configurable**: Enable/disable in STRING, DISPLAY

#### 9. **Lowercase Code** *(Optional - disabled by default)*
Identifies lowercase code (COBOL should be uppercase).

- ✅ **Quick Fix**: Convert to uppercase
- 🎯 **Severity**: Warning

#### 10. **File Operations**
Checks if declared files (SELECT) have all necessary operations:
- OPEN
- CLOSE
- READ or WRITE

- 🎯 **Severity**: Warning

#### 11. **Cursor Operations**
Checks if declared SQL cursors have all necessary operations:
- OPEN
- FETCH
- CLOSE

- 🎯 **Severity**: Warning

#### 12. **Unused Level 88 Conditions**
Detects level 88 condition names that are declared but never used in the code.

- ✅ **Quick Fix**: Delete line or comment with asterisk
- 🎯 **Severity**: Warning
- 🔧 **Smart Detection**:
  - Validates each 88-level condition independently
  - Ignores 88-level conditions associated with FILLER variables
  - Example: `88 STATUS-OK VALUE 'Y'` triggers warning if `STATUS-OK` is never used

#### 13. **Cursor Navigation** (NEW in 1.3.0)

- ***Go to Definition (Ctrl+Click / F12)*** - Click or F12 on any cursor name (in OPEN, FETCH, CLOSE, or DECLARE) to jump to the cursor declaration.

- ***Find All References (Shift+F12)*** - Shows all references (OPEN, FETCH, CLOSE, and declaration) for the selected cursor.

>This makes it easy to navigate and refactor SQL cursors in COBOL code!


## Requirements

- Visual Studio Code 1.75.0 or higher
- COBOL files with extensions: `.cbl`, `.cob`, `.cobol`, `.cpy`

## Compatibility

✅ **Works with:**
- Local COBOL files
- Remote files via Zowe Explorer (datasets and USS)
- Remote files via VS Code Remote extensions
- All Quick Fixes available for both local and remote files

## Performance

⚡ **Optimized for large files:**
- Smart caching system - validates only when content changes
- Debounced validation - waits 500ms after you stop typing
- Minimal overhead - debug logging disabled by default

## Settings

This extension contributes the following settings:

### Validations (Enable/Disable)

| Setting | Default | Description |
|---------|---------|-------------|
| `zcobol-validation.enableUnusedVariableCheck` | `true` | Enable unused variable validation |
| `zcobol-validation.enableUnusedLevel88Check` | `true` | Enable unused level 88 condition validation |
| `zcobol-validation.enableUnprotectedDisplayCheck` | `true` | Enable unprotected display validation |
| `zcobol-validation.enableGoToCheck` | `true` | Enable GO TO command validation |
| `zcobol-validation.enableUnmatchedIfCheck` | `true` | Enable IF without END-IF validation |
| `zcobol-validation.enableIfWithoutElseCheck` | `false` | Enable IF without ELSE validation |
| `zcobol-validation.enableEvaluateWithoutWhenOtherCheck` | `false` | Enable EVALUATE without WHEN OTHER validation |
| `zcobol-validation.enableSymbolicOperatorCheck` | `true` | Enable symbolic operator validation |
| `zcobol-validation.enableHardcodedCheck` | `true` | Enable hardcoded value validation |
| `zcobol-validation.enableLowerCaseCheck` | `false` | Enable lowercase code validation |
| `zcobol-validation.enableFileOperationsCheck` | `true` | Enable file operations validation |
| `zcobol-validation.enableCursorOperationsCheck` | `true` | Enable cursor operations validation |

### Additional Options

| Setting | Default | Description |
|---------|---------|-------------|
| `zcobol-validation.operatorFormat` | `"long"` | Operator format: "long" (LESS THAN OR EQUAL) or "short" (LESS OR EQUAL) |
| `zcobol-validation.enableHardcodedInString` | `false` | Validate hardcoded values in STRING/UNSTRING |
| `zcobol-validation.enableHardcodedInDisplay` | `false` | Validate hardcoded values in DISPLAY |
| `zcobol-validation.defaultIfCondition` | `""` | Default condition for IF blocks (e.g., "1 = 1") |
| `zcobol-validation.constantPrefix` | `"con-"` | Prefix for generated constant names |

## Usage Examples

### Create Constant from Hardcode

```cobol
IF WS-STATUS = '00'    ⚠️ Warning: Hardcoded value
```

**Quick Fix** → Automatically generates:
```cobol
01  CON-00    PIC X(02) VALUE '00'.
...
IF WS-STATUS = CON-00
```

### Wrap DISPLAY with IF

```cobol
DISPLAY 'Processing error'.    ⚠️ Warning: Unprotected DISPLAY
```

**Quick Fix** → Transforms to:
```cobol
IF ${condition}
   DISPLAY 'Processing error'
END-IF.
```

### Replace Symbolic Operators

```cobol
IF WS-COUNTER > 10              ⚠️ Use 'GREATER THAN' instead of '>'
```

**Quick Fix** → Converts to:
```cobol
IF WS-COUNTER GREATER THAN 10
```

## Known Issues

- Cursor validation requires well-formatted `EXEC SQL...END-EXEC` blocks
- Some dynamically generated code cases may not be detected

## Release Notes

### 1.2.0 - 2026-03-14

**Performance & Compatibility**
- Significant performance improvements with debouncing and caching
- Full support for Zowe Explorer (datasets and USS files)
- Optimized resource management and memory usage
- Debug logging disabled by default for better performance

### 1.1.0 - 2026-03-13

- Added unused level 88 condition validation
- Enhanced unused variable detection with level 88 awareness
- Improved FILLER variable handling

### 1.0.0 - 2026-03-11

Initial comprehensive release with:
- Unused variable validation
- Unprotected display validation
- GO TO command validation
- IF without END-IF validation
- IF without ELSE validation (optional)
- EVALUATE without WHEN OTHER validation (optional)
- Symbolic operator validation
- Hardcoded value validation
- Lowercase code validation (optional)
- File operations validation
- Cursor operations validation
- Automatic quick fixes
- Customizable settings
