       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTCURSOR.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-EMPLOYEE-ID           PIC 9(05).
       01  WS-EMPLOYEE-NAME         PIC X(50).
       01  WS-EMPLOYEE-SALARY       PIC 9(07)V99.
       01  WS-SQLCODE               PIC S9(09) COMP.
       01  WS-EOF                   PIC X VALUE 'N'.

      *    Cursor completo - tem OPEN, FETCH e CLOSE
           EXEC SQL
               DECLARE CURSOR-COMPLETO CURSOR FOR
               SELECT EMPLOYEE_ID, EMPLOYEE_NAME, SALARY
               FROM EMPLOYEES
               WHERE DEPARTMENT = 'IT'
           END-EXEC.

      *    Cursor sem FETCH - só tem OPEN e CLOSE
           EXEC SQL
               DECLARE CURSOR-SEM-FETCH CURSOR FOR
               SELECT EMPLOYEE_ID, EMPLOYEE_NAME
               FROM EMPLOYEES
               WHERE DEPARTMENT = 'HR'
           END-EXEC.

      *    Cursor sem CLOSE - só tem OPEN e FETCH
           EXEC SQL
               DECLARE CURSOR-SEM-CLOSE CURSOR FOR
               SELECT EMPLOYEE_ID
               FROM EMPLOYEES
               WHERE ACTIVE = 'Y'
           END-EXEC.

      *    Cursor sem OPEN - só tem FETCH e CLOSE
           EXEC SQL
               DECLARE CURSOR-SEM-OPEN CURSOR FOR
               SELECT DEPARTMENT_NAME
               FROM DEPARTMENTS
           END-EXEC.

      *    Cursor sem nenhuma operação
           EXEC SQL
               DECLARE CURSOR-SEM-NADA CURSOR FOR
               SELECT COUNT(*)
               FROM EMPLOYEES
           END-EXEC.

       PROCEDURE DIVISION.
       MAIN-PROCEDURE.

      *    CURSOR-COMPLETO - todas as operações presentes
           EXEC SQL
               OPEN CURSOR-COMPLETO
           END-EXEC.

           PERFORM UNTIL WS-EOF = 'S'
               EXEC SQL
                   FETCH CURSOR-COMPLETO
                   INTO :WS-EMPLOYEE-ID,
                        :WS-EMPLOYEE-NAME,
                        :WS-EMPLOYEE-SALARY
               END-EXEC

               IF SQLCODE NOT = 0
                   MOVE 'S' TO WS-EOF
               ELSE
                   DISPLAY 'Employee: ' WS-EMPLOYEE-NAME
               END-IF
           END-PERFORM.

           EXEC SQL
               CLOSE CURSOR-COMPLETO
           END-EXEC.

      *    CURSOR-SEM-FETCH - falta FETCH
           EXEC SQL
               OPEN CURSOR-SEM-FETCH
           END-EXEC.

           EXEC SQL
               CLOSE CURSOR-SEM-FETCH
           END-EXEC.

      *    CURSOR-SEM-CLOSE - falta CLOSE
           EXEC SQL
               OPEN CURSOR-SEM-CLOSE
           END-EXEC.

           EXEC SQL
               FETCH CURSOR-SEM-CLOSE
               INTO :WS-EMPLOYEE-ID
           END-EXEC.

      *    CURSOR-SEM-OPEN - falta OPEN
           EXEC SQL
               FETCH CURSOR-SEM-OPEN
               INTO :WS-EMPLOYEE-NAME
           END-EXEC.

           EXEC SQL
               CLOSE CURSOR-SEM-OPEN
           END-EXEC.

      *    CURSOR-SEM-NADA não tem nenhuma operação

           STOP RUN.
