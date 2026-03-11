# zCobol Validation

Visual Studio Code extension that provides advanced validations for COBOL programs, helping maintain code quality and programming best practices.

## Features

### 🔍 Available Validations

#### 1. **Unused Variables**
Detects variables declared in WORKING-STORAGE or LINKAGE SECTION that are not used in the code.

- ✅ **Quick Fix**: Delete line or comment with asterisk
- 🎯 **Severity**: Warning

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

## Requirements

- Visual Studio Code 1.75.0 or higher
- COBOL files with extensions: `.cbl`, `.cob`, `.cobol`, `.cpy`

## Settings

This extension contributes the following settings:

### Validations (Enable/Disable)

| Setting | Default | Description |
|---------|---------|-------------|
| `zcobol-validation.enableUnusedVariableCheck` | `true` | Enable unused variable validation |
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

### 0.0.1

Initial release with:
- Unused variable validation
- Unprotected display validation
- GO TO command validation
- IF without END-IF validation
- Symbolic operator validation
- Hardcoded value validation
- File operations validation
- Cursor operations validation
- Automatic quick fixes
- Customizable settings

---

**Developed for mainframe COBOL development teams** 🚀

## Working with Markdown

You can author your README using Visual Studio Code.  Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
