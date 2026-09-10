# Atualização da Tela de Treino - Layout SpeedCoach

## O que foi alterado
1. **Design SpeedCoach**: A interface da aba "Treino" foi reconstruída para imitar fielmente o visor do SpeedCoach (conforme a imagem de referência). Ela possui:
   - Fundo branco com bordas pretas separando os quadrantes, e uma moldura principal mais grossa remetendo ao estilo verde.
   - 4 Quadrantes principais: SPM (Voga) no canto superior esquerdo, Pace (/500M) no superior direito, TEMPO no inferior esquerdo e METROS no inferior direito.
   - Uma barra superior preta exibindo a hora atual, ícone de GPS, Bateria e Coração.

2. **Posição dos botões Iniciar/Parar e Abas**: 
   - A barra de navegação "Treino | Sprints | Sensores" foi movida para a base da tela, logo acima dos botões principais.
   - O botão "Gravar" agora fica fixado na parte inferior, e foi ligeiramente aumentado para facilitar o toque durante a atividade.

3. **Função Pausar**: 
   - Adicionamos a funcionalidade de "Pausar", que substitui o botão único por dois botões ("Pausar" / "Parar") durante o treino.
   - Quando pausado, o tempo no aplicativo para de contar, evitando o registro de telemetria indesejada em momentos que o treinador está passando instruções ou o atleta está descansando sem querer afetar suas médias visíveis.

## Resultados
- A usabilidade foi aprimorada, entregando um produto idêntico aos monitores de remo de alta performance (SpeedCoach).
- Os testes unitários continuam aprovados com 100% de sucesso nas validações de telemetria.
