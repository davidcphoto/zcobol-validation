       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTPROG.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-VARIAVEL-USADA        PIC X(10).
       01  WS-VARIAVEL-NAO-USADA    PIC X(10).
       01  WS-CONTADOR              PIC 9(05).
       01  WS-GRUPO-USADO.
           05  WS-CAMPO1            PIC X(10).
           05  WS-CAMPO2            PIC 9(05).
       01  WS-GRUPO-NAO-USADO.
           05  WS-CAMPO3            PIC X(10).
           05  WS-CAMPO4            PIC 9(05).

       PROCEDURE DIVISION.
           DISPLAY 'Teste: ' WS-VARIAVEL-USADA.
           MOVE 5 TO WS-CONTADOR.
           DISPLAY 'Contador: ' WS-CONTADOR.
           MOVE 'TESTE' TO WS-CAMPO1.
           MOVE 10 TO WS-CAMPO2.
           STOP RUN.
