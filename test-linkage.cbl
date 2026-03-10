       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTLINKAGE.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-CONTADOR              PIC 9(05).
       01  WS-NAO-USADA             PIC X(10).

       LINKAGE SECTION.
       01  LS-PARAMETRO1            PIC X(20).
       01  LS-PARAMETRO2            PIC 9(05).
       01  LS-NAO-USADA             PIC X(10).
       01  LS-ESTRUTURA.
           05  LS-CAMPO1            PIC X(10).
           05  LS-CAMPO2-REF        PIC 9(05).
           05  LS-CAMPO2            PIC 9(05).

       PROCEDURE DIVISION USING LS-PARAMETRO1
                                LS-PARAMETRO2
                                LS-ESTRUTURA.

       MAIN-SECTION.
           MOVE 'TESTE' TO LS-PARAMETRO1.
           COMPUTE WS-CONTADOR = LS-PARAMETRO2 + 10.
           MOVE LS-PARAMETRO2 TO LS-CAMPO2-REF.

      *    COMPUTE multi-linha - deve validar hardcode
           COMPUTE WS-CONTADOR = LS-PARAMETRO2
                                 + 100
                                 * 5.

           COMPUTE WS-CONTADOR = (LS-PARAMETRO2 * 2)
                                 + 50
                                 - 10.

      *    Teste de numeros dentro de strings - NAO devem ser validados
           MOVE '12345' TO LS-PARAMETRO1.
           MOVE "98765" TO LS-CAMPO1.

      *    Exemplos de criacao de constantes:
      *    '99' -> sugerira con-99 (nao con--99-- com hifens)
      *    'TESTE' -> sugerira con-TESTE
      *    'ABC-XYZ' -> sugerira con-ABC-XYZ
           MOVE '99' TO LS-CAMPO1.
           IF LS-PARAMETRO1 = 'CODIGO'
              DISPLAY 'Codigo encontrado'
           END-IF.

      *    Numeros fora de strings - DEVEM ser validados
           COMPUTE WS-CONTADOR = 999.
           MOVE 777 TO WS-CONTADOR.

           DISPLAY 'Parametro 1: ' LS-PARAMETRO1.
           DISPLAY 'Campo 1: ' LS-CAMPO1.
           DISPLAY 'Campo 2: ' LS-CAMPO2.

           GOBACK.
