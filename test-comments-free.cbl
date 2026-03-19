       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST-COMMENTS-FREE.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * Esta variável está comentada e não deve ser validada
      * 01 VARIAVEL-COMENTADA PIC X(10).

      * Nível 88 comentado
      * 88 CONDICAO-COMENTADA VALUE 'S'.

       01 VARIAVEL-VALIDA PIC X(10).
          88 CONDICAO-VALIDA VALUE 'S'.

      * Esta variável também está comentada
      *01 OUTRA-COMENTADA PIC 9(05).

       PROCEDURE DIVISION.

      * Este código comentado não deve gerar warnings
      * DISPLAY VARIAVEL-COMENTADA
      * IF CONDICAO-COMENTADA
      *    MOVE 'X' TO VARIAVEL-COMENTADA
      * END-IF.

           DISPLAY 'Teste OK'.
           STOP RUN.