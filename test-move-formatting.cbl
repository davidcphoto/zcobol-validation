       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST-MOVE-FORMATTING.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-EMPLOYEE-NAME PIC X(30).
       01 WS-STATUS-MESSAGE PIC X(50).
       01 WS-COUNTER PIC 9(05).
       01 WS-LONG-VARIABLE-NAME-FOR-TESTING PIC X(40).

       PROCEDURE DIVISION.

      * MOVE curto - TO deve manter na mesma linha apos substituicao
           MOVE 'ABC' TO WS-STATUS-MESSAGE.

      * MOVE medio - TO deve manter na mesma linha
           MOVE 'EMPLOYEE_ACTIVE' TO WS-STATUS-MESSAGE.

      * MOVE longo - TO deve ir para linha seguinte se exceder col 72
           MOVE 'THIS_IS_A_VERY_LONG_CONSTANT_VALUE' TO WS-LONG-VARIABLE
      -    -NAME-FOR-TESTING.

      * MOVE com valor numerico curto
           MOVE 12345 TO WS-COUNTER.

      * MOVE com valor numerico longo
           MOVE 9999999 TO WS-COUNTER.

      * MOVE que ja esta no limite da coluna 72
           MOVE 'VALUE_AT_COLUMN_BOUNDARY_XXXXXXXXXX' TO WS-LONG-VARIABLE-NAME-FOR-TESTING.

      * Outros comandos com hardcode (nao sao MOVE TO)
           IF WS-STATUS-MESSAGE = 'ACTIVE'
               DISPLAY 'Status is active'
           END-IF.

           COMPUTE WS-COUNTER = 100 + 50.

           STOP RUN.
