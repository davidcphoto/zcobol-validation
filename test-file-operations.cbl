       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTFILE.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ARQUIVO-ENTRADA
               ASSIGN TO "ENTRADA.DAT"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-STATUS-ENTRADA.

           SELECT ARQUIVO-SAIDA
               ASSIGN TO "SAIDA.DAT"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-STATUS-SAIDA.

           SELECT ARQUIVO-COMPLETO
               ASSIGN TO "COMPLETO.DAT"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-STATUS-COMPLETO.

           SELECT ARQUIVO-SEM-NADA
               ASSIGN TO "SEMNADA.DAT"
               ORGANIZATION IS LINE SEQUENTIAL.

       DATA DIVISION.
       FILE SECTION.
       FD  ARQUIVO-ENTRADA.
       01  REG-ENTRADA.
           05  CAMPO-ENTRADA        PIC X(100).

       FD  ARQUIVO-SAIDA.
       01  REG-SAIDA.
           05  CAMPO-SAIDA          PIC X(100).

       FD  ARQUIVO-COMPLETO.
       01  REG-COMPLETO.
           05  CAMPO-COMPLETO       PIC X(100).

       FD  ARQUIVO-SEM-NADA.
       01  REG-SEM-NADA.
           05  CAMPO-SEM-NADA       PIC X(100).

       WORKING-STORAGE SECTION.
       01  WS-STATUS-ENTRADA        PIC XX.
       01  WS-STATUS-SAIDA          PIC XX.
       01  WS-STATUS-COMPLETO       PIC XX.
       01  WS-EOF                   PIC X VALUE 'N'.

       PROCEDURE DIVISION.
       MAIN-PROCEDURE.
      *    ARQUIVO-COMPLETO tem todas as operações
           OPEN INPUT ARQUIVO-COMPLETO.
           READ ARQUIVO-COMPLETO
               AT END
                   MOVE 'S' TO WS-EOF
           END-READ.
           CLOSE ARQUIVO-COMPLETO.

      *    ARQUIVO-ENTRADA só tem OPEN (falta CLOSE e READ)
           OPEN INPUT ARQUIVO-ENTRADA.

      *    ARQUIVO-SAIDA só tem WRITE (falta OPEN e CLOSE)
           WRITE REG-SAIDA.

      *    ARQUIVO-SEM-NADA não tem nenhuma operação

           STOP RUN.
