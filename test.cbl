       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTPROG.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-VARIAVEL-USADA        PIC X(10).
       01  WS-VARIAVEL-NAO-USADA    PIC X(10).
       01  WS-CONTADOR              PIC 9(05).
       01  WS-INDICE                PIC 9(05).
       01  WS-RESULTADO             PIC 9(05).
       01  WS-GRUPO-USADO.
           05  WS-CAMPO1            PIC X(10).
           05  WS-CAMPO2            PIC 9(05).
       01  WS-GRUPO-NAO-USADO.
           05  WS-CAMPO3            PIC X(10).
           05  WS-CAMPO4            PIC 9(05).

       PROCEDURE DIVISION.
           DISPLAY 'Teste sem IF - nao protegido'.
           DISPLAY 'Teste: ' WS-VARIAVEL-USADA.
           MOVE 5 TO WS-CONTADOR.

           IF WS-CONTADOR < 10
              GO TO SECAO-FINAL
           END-IF.

           DISPLAY 'Contador: ' WS-CONTADOR.

           IF WS-CONTADOR > 0
              DISPLAY 'Dentro de IF - protegido'
              MOVE 'TESTE'       TO WS-CAMPO1
              MOVE 10            TO WS-CAMPO2
           END-IF.

      *    Criacao de constantes:
      *    '99' -> nome sugerido: CON-99 (conteudo sem aspas)
      *    'STATUS-OK' -> nome sugerido: CON-STATUS-OK
      *    "ERRO" -> nome sugerido: CON-ERRO
           IF WS-CONTADOR = 5
              DISPLAY 'Contador igual a 5'

           DISPLAY 'Outro display sem IF - nao protegido'.

           GOTO SECAO-FIM.

       SECAO-TESTES-HARDCODE.
      *    Teste de hardcode em PERFORM
           PERFORM 10 TIMES
              DISPLAY 'Loop iteration'
           END-PERFORM.

           PERFORM VARYING WS-INDICE FROM 1 BY 1 UNTIL WS-INDICE > 100
              DISPLAY WS-INDICE
           END-PERFORM.

      *    Teste de hardcode em COMPUTE
           COMPUTE WS-RESULTADO = WS-CONTADOR * 5.
           COMPUTE WS-RESULTADO = WS-CONTADOR + 100.
           COMPUTE WS-RESULTADO = (WS-CONTADOR * 2) + 50.

      *    Teste de hardcode em COMPUTE multi-linha
           COMPUTE WS-RESULTADO = WS-CONTADOR
                                  + 25
                                  * 3.

           COMPUTE WS-RESULTADO = (WS-CONTADOR * 10)
                                  - 5
                                  + 200.

      *    Teste: numeros dentro de strings NAO devem ser validados
           MOVE 'CODIGO123' TO WS-VARIAVEL-USADA.
           MOVE "REF456ABC" TO WS-CAMPO1.
           IF WS-CONTADOR = '999'
              DISPLAY 'Teste 999'
           END-IF.

      *    Mas numeros fora de strings DEVEM ser validados
           MOVE 888 TO WS-CONTADOR.

       SECAO-FINAL.
           DISPLAY 'Secao final'.

       SECAO-FIM.
           STOP RUN.
