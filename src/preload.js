// Ponte segura entre a tela e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('estudio', {
  provedores: () => ipcRenderer.invoke('provedores'),
  executarAgente: (dados) => ipcRenderer.invoke('executar-agente', dados),
  executarComando: (dados) => ipcRenderer.invoke('executar-comando', dados),
  escolherPasta: () => ipcRenderer.invoke('escolher-pasta'),
  pastaPadrao: () => ipcRenderer.invoke('pasta-padrao'),
  arquivosAlterados: (dados) => ipcRenderer.invoke('arquivos-alterados', dados),
  abrir: (dados) => ipcRenderer.invoke('abrir', dados),
  chaves: () => ipcRenderer.invoke('chaves'),
  salvarChave: (dados) => ipcRenderer.invoke('chave-salvar', dados),
  removerChave: (dados) => ipcRenderer.invoke('chave-remover', dados),
  testarProvedor: (dados) => ipcRenderer.invoke('provedor-testar', dados),
  portao: (dados) => ipcRenderer.invoke('portao', dados),
  isolamento: () => ipcRenderer.invoke('isolamento'),
});
