       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST-HARDCODE-NUMERIC.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-COUNTER        PIC 9(03) VALUE ZEROS.
       01  WS-RESULT         PIC 9(05) VALUE ZEROS.
       01  WS-NAME           PIC X(30) VALUE SPACES.

       PROCEDURE DIVISION.

      * Casos de teste para detecção de hardcode numérico
       MAIN-LOGIC.
           MOVE 100    TO WS-COUNTER.
           ADD 50 TO WS-RESULT.
           COMPUTE WS-RESULT = WS-COUNTER * 10.

           IF WS-COUNTER > 5
               DISPLAY 'Counter is greater than 5'
           END-IF.

           IF WS-RESULT = 150
               DISPLAY 'Result is 150'
           END-IF.

           EVALUATE WS-COUNTER
               WHEN 10
                   DISPLAY 'Counter is 10'
               WHEN 20
                   DISPLAY 'Counter is 20'
           END-EVALUATE.

           PERFORM PROCESS-DATA 3 TIMES.

           STOP RUN.

       PROCESS-DATA.
           ADD 1 TO WS-COUNTER.
           DISPLAY WS-COUNTER.