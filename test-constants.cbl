       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST-CONSTANTS.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * Constante declarada corretamente - não deve gerar warning
       01 WS-MAX-RECORDS PIC 9(05) VALUE 10000.
       01 WS-COMPANY-NAME PIC X(30) VALUE 'ACME CORP'.

      * Variável sem VALUE - não é constante
       01 WS-COUNTER PIC 9(05).
       01 WS-RESULT PIC X(50).

       PROCEDURE DIVISION.

      * Constante declarada incorretamente - deve gerar warning
       01 WS-PROC-CONSTANT PIC X(10) VALUE 'INVALID'.

      * Outra constante incorreta em várias linhas - deve gerar warning
       77 WRONG-CONSTANT
           PIC 9(03)
           VALUE 999.

      * Variável sem VALUE na PROCEDURE - não deve gerar warning
       01 WS-TEMP-VAR PIC X(10).

      * Constante numérica incorreta - deve gerar warning
       01 MAX-LIMIT PIC 9(05) VALUE 50000.

      * Código normal que usa as constantes corretas
           MOVE WS-MAX-RECORDS TO WS-COUNTER.
           MOVE WS-COMPANY-NAME TO WS-RESULT.

           IF WS-COUNTER > MAX-LIMIT
               DISPLAY 'Limite excedido'
           END-IF.

           DISPLAY WS-PROC-CONSTANT.
           DISPLAY WRONG-CONSTANT.

           STOP RUN.
