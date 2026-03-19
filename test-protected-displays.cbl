       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST-PROTECTED-DISPLAYS.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-OPCAO PIC 9.
       01 WS-STATUS PIC X.

       PROCEDURE DIVISION.

      * DISPLAY desprotegido - deve gerar warning
           DISPLAY 'Inicio do programa'.

      * DISPLAY protegido por IF - não deve gerar warning
           IF WS-STATUS = 'A'
               DISPLAY 'Status ativo'
           END-IF.

      * DISPLAY protegido por EVALUATE - não deve gerar warning
           EVALUATE WS-OPCAO
               WHEN 1
                   DISPLAY 'Opcao 1 selecionada'
               WHEN 2
                   DISPLAY 'Opcao 2 selecionada'
               WHEN OTHER
                   DISPLAY 'Opcao invalida'
           END-EVALUATE.

      * DISPLAY protegido por EVALUATE aninhado - não deve gerar warning
           EVALUATE TRUE
               WHEN WS-STATUS = 'A'
                   EVALUATE WS-OPCAO
                       WHEN 1
                           DISPLAY 'Status A, Opcao 1'
                       WHEN OTHER
                           DISPLAY 'Status A, outra opcao'
                   END-EVALUATE
               WHEN OTHER
                   DISPLAY 'Outro status'
           END-EVALUATE.

      * DISPLAY desprotegido - deve gerar warning
           DISPLAY 'Fim do programa'.

           STOP RUN.
