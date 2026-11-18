/* Sistema de Atendimentos — Field (site estático + Firebase) */
import { api } from './firebase.js?v=20261118e';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

// Listas da planilha original
const STATUS = ['ENCAMINHADO', 'TENT CONTATO', 'AGENDADO', 'FECHADO'];
const ENCAMINHADO_PARA = ['GARANTIA', 'GLOBAL', 'LOGISTICA', 'QUALITY INFRA', 'SOFTPLAN', 'STI', 'REMOTO', 'REVOKE', 'VOLANTE', 'CTIS', 'VALID'];
const HOME_LOCAL = ['HOME', 'LOCAL'];
// DEVOLVIDO: o setor devolveu o chamado e ele foi reaberto em uma nova "ida" (registro novo com o mesmo SMAX)
const MOTIVOS_DEVOLUCAO = ['Faltou informação', 'Fora do escopo do setor', 'Resolvido em parte', 'Precisa de atendimento local'];
const PODE_REABRIR = ['ENCAMINHADO', 'FECHADO', ''];   // '' = salvo sem status
const fmtAgenda = v => v ? `${fmtData(v)} ${v.slice(11, 16)}` : 'sem horário';
// agendamento com período: das (agendamento) até (agendamento_fim). Dia inteiro = 09:00 às 17:00. Sem fim = 1 hora.
const DIA_INTEIRO = ['09:00', '17:00'];
function somarMin(v, min) { const d = new Date(v); d.setMinutes(d.getMinutes() + min - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function fimAgenda(a) {
  if (!a.agendamento) return '';
  if (a.agendamento_fim && a.agendamento_fim > a.agendamento) return a.agendamento_fim;
  if (a.dia_inteiro) return a.agendamento.slice(0, 11) + DIA_INTEIRO[1];
  return somarMin(a.agendamento, 60);
}
const fmtPeriodo = a => a.agendamento ? `${fmtData(a.agendamento)} ${a.dia_inteiro ? 'dia inteiro' : a.agendamento.slice(11, 16) + (a.agendamento_fim ? '–' + a.agendamento_fim.slice(11, 16) : '')}${a.juri ? ' ⚖️ Júri' : ''}` : 'sem horário';
const ordinal = n => `${n}ª ida`;

const S = {
  conta: null,        // usuário do Firebase Auth
  perfil: null,       // documento em "usuarios"
  usuarios: null,     // equipe (cache)
  mes: mesAtual(),
  filtros: { q: '', status: '', tecnico: null, dia: '' },
  painelTec: '',
  painelDia: '',
  telaAuth: 'entrar',
};
const isAdmin = () => S.perfil && S.perfil.perfil === 'admin';

// --------------------------------------------------------------- utilidades
function mesAtual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function hojeISO() { return agoraLocal().slice(0, 10); }
function agoraLocal() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function fmtDH(v) { if (!v) return ''; const [d, t] = v.split('T'); const [, m, dd] = d.split('-'); return `${dd}/${m} ${t || ''}`.trim(); }
function fmtData(v) { if (!v) return ''; const [y, m, d] = v.slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function duracao(ini, fim) {
  if (!ini || !fim) return '';
  const min = Math.round((new Date(fim) - new Date(ini)) / 60000);
  if (isNaN(min) || min < 0) return '';
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}
function nomeMes(m) { const [y, mm] = m.split('-'); return new Date(+y, +mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
const chip = st => st ? `<span class="chip ${esc(st.split(' ')[0])}">${esc(st)}</span>` : '<span class="muted">—</span>';
const iniciais = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
const ordenar = l => l.sort((a, b) => (b.inicio || b.data_ref || '').localeCompare(a.inicio || a.data_ref || ''));
const dominioTxt = () => `nome@${api.DOMINIOS[0] || 'empresa.com.br'}`;
function emailDaEmpresa(email) {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  return !api.DOMINIOS.length || api.DOMINIOS.map(d => d.toLowerCase()).includes(e.split('@')[1]);
}
function senhaFraca(s) {
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'A senha precisa ter letras e números.';
  return null;
}
function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (erro ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', 3500);
}
const erroBox = (el, msg) => { el.innerHTML = msg ? `<div class="err">${esc(msg)}</div>` : ''; };

// --------------------------------------------------------------- comarcas padronizadas
const chaveComarca = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function tituloComarca(v) {
  const peq = ['de', 'da', 'do', 'das', 'dos', 'e'];
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ')
    .map((p, i) => i && peq.includes(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
const listaComarcas = () => S.comarcasOficiais || [];
function comarcaOficial(v) {
  const k = chaveComarca(v); if (!k) return null;
  return listaComarcas().find(c => chaveComarca(c) === k) || null;
}
const nomeComarca = v => comarcaOficial(v) || tituloComarca(v);

// --------------------------------------------------------------- normalização (formulário e importação)
const s = v => (v === undefined || v === null ? '' : String(v)).trim();
function normStatus(v) {
  const t = s(v).toUpperCase();
  if (!t) return '';
  if (t === 'E' || t.startsWith('ENCAMINH')) return 'ENCAMINHADO';
  if (t === 'H' || t.startsWith('TENT')) return 'TENT CONTATO';
  if (t === 'A' || t.startsWith('AGEND') || t.startsWith('CONTATO')) return 'AGENDADO';
  if (t === 'F' || t.startsWith('FECH')) return 'FECHADO';
  if (t.startsWith('DEVOL')) return 'DEVOLVIDO';
  return '';
}
function normHomeLocal(v) {
  const t = s(v).toUpperCase();
  if (t === 'H' || t.startsWith('HOME') || t.startsWith('REMOTO')) return 'HOME';
  if (t === 'L' || t.startsWith('LOCAL')) return 'LOCAL';
  return '';
}
function normDataHora(v) {
  if (v === undefined || v === null || v === '') return '';
  const p = n => String(n).padStart(2, '0');
  if (typeof v === 'number' && v > 1) { 
    const d = new Date(Math.round((v - 25569) * 1440) * 60000);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  const t = s(v);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); if (m) return `${m[3]}-${p(m[2])}-${p(m[1])}T${p(m[4] || 0)}:${p(m[5] || 0)}`;
  return '';
}
function montarAtendimento(b, uid, tecnico) {
  const at = {
    uid, tecnico: s(tecnico).slice(0, 80),
    smax: s(b.smax).slice(0, 60), comarca: s(b.comarca).slice(0, 120),
    inicio: normDataHora(b.inicio), termino: normDataHora(b.termino),
    ticket_softplan: s(b.ticket_softplan).slice(0, 60), status: normStatus(b.status),
    encaminhado_para: ENCAMINHADO_PARA.includes(s(b.encaminhado_para).toUpperCase()) ? s(b.encaminhado_para).toUpperCase() : '',
    home_local: normHomeLocal(b.home_local), agendamento: normDataHora(b.agendamento), agendamento_fim: normDataHora(b.agendamento_fim),
    dia_inteiro: b.dia_inteiro === true || b.dia_inteiro === 'on', juri: b.juri === true || b.juri === 'on',
    usuario_atendido: s(b.usuario_atendido).slice(0, 120), obs: s(b.obs).slice(0, 2000),
  };
  if (at.status !== 'AGENDADO') { at.agendamento_fim = ''; at.dia_inteiro = false; at.juri = false; }
  at.data_ref = (at.inicio || at.agendamento || '').slice(0, 10) || hojeISO();
  at.mes = at.data_ref.slice(0, 7);
  return at;
}
function validar(at) {
  if (!at.smax && !at.ticket_softplan) return 'Informe o nº da solicitação SMAX (ou o ticket Softplan).';
  if (!at.comarca) return 'Informe a comarca.';
  if (at.inicio && at.termino && at.termino < at.inicio) return 'O término não pode ser antes do início.';
  return null;
}

// --------------------------------------------------------------- regras de perfil e fila home office
function filtrarChamadosPorPerfil(lista) {
  if (isAdmin()) return lista;
  return lista.filter(x => x.uid === S.perfil.id || (Array.isArray(x.uids) && x.uids.includes(S.perfil.id)));
}

const COMARCAS_HOME_FILA = ['Bragança Paulista', 'Atibaia', 'Guarulhos'];

function obterProximaComarcaHome(comarcaAtual) {
  const norm = chaveComarca(comarcaAtual);
  let index = COMARCAS_HOME_FILA.findIndex(c => chaveComarca(c) === norm);
  if (index === -1) index = 0;
  const proximaIndex = (index + 1) % COMARCAS_HOME_FILA.length;
  return COMARCAS_HOME_FILA[proximaIndex];
}

function verificarPopupFilaHomeOffice(atendimentoAntigo, atendimentoNovo) {
  const foiFechadoAgora = atendimentoNovo.status === 'FECHADO' && (!atendimentoAntigo || atendimentoAntigo.status !== 'FECHADO');
  if (foiFechadoAgora && atendimentoNovo.home_local === 'HOME') {
    const comarcaAtual = atendimentoNovo.comarca;
    const proximaComarca = obterProximaComarcaHome(comarcaAtual);

    setTimeout(() => {
      modal(
        '🔄 Fila de Atendimento Home Office',
        `<div style="padding: 10px 0;">
           <p>O atendimento <b>HOME</b> da comarca <b>${esc(comarcaAtual)}</b> foi fechado.</p>
           <p>Próximo da fila para atendimento Home Office:</p>
           <div style="background: var(--brand-soft, #eef1f5); color: var(--brand, #1f2937); padding: 12px; border-radius: 8px; text-align: center; font-size: 16px; font-weight: bold; margin: 12px 0;">
             📍 Comarca: ${esc(proximaComarca)}
           </div>
           <p class="hint">Deseja abrir um novo atendimento Home para esta comarca agora?</p>
         </div>`,
        [
          { t: 'Fechar' },
          { 
            t: 'Criar Atendimento Home', 
            primary: true, 
            fn: () => {
              setTimeout(() => {
                formAtendimento({ home_local: 'HOME', comarca: proximaComarca });
              }, 200);
              return true;
            } 
          }
        ],
        'sm'
      );
    }, 300);
  }
}

// --------------------------------------------------------------- campanha do mês
const CAMPANHAS = [
  { mes: 'Janeiro', nome: 'Janeiro Branco', cor: '#eef1f5', claro: true, tema: 'Saúde mental',
    texto: 'Mês de cuidar da saúde mental e emocional. Converse, peça ajuda e acolha quem precisa. Apoio emocional gratuito: CVV 188 (24h).' },
  { mes: 'Fevereiro', nome: 'Fevereiro Roxo', cor: '#6b2fa0', tema: 'Lúpus, fibromialgia e Alzheimer',
    texto: 'Conscientização sobre doenças crônicas sem cura, como lúpus, fibromialgia e Alzheimer. O diagnóstico precoce melhora a qualidade de vida.' },
  { mes: 'Março', nome: 'Março Lilás', cor: '#8450b8', tema: 'Câncer de colo de útero',
    texto: 'Prevenção ao câncer de colo do útero. O exame preventivo (Papanicolau) e a vacina contra o HPV salvam vidas.' },
  { mes: 'Abril', nome: 'Abril Azul', cor: '#1f5fae', tema: 'Autismo',
    texto: 'Conscientização sobre o Transtorno do Espectro Autista (TEA). Informação e respeito promovem inclusão.' },
  { mes: 'Maio', nome: 'Maio Amarelo', cor: '#f5c518', claro: true, tema: 'Segurança no trânsito',
    texto: 'Atenção pela vida no trânsito. No deslocamento entre comarcas: cinto, velocidade adequada e celular longe do volante.' },
  { mes: 'Junho', nome: 'Junho Vermelho', cor: '#b3202a', tema: 'Doação de sangue',
    texto: 'Incentivo à doação de sangue. Uma doação pode ajudar várias pessoas. Procure o hemocentro mais próximo.' },
  { mes: 'Julho', nome: 'Julho Amarelo', cor: '#f5c518', claro: true, tema: 'Hepatites virais',
    texto: 'Prevenção e diagnóstico das hepatites virais. Faça o teste e mantenha a vacinação em dia.' },
  { mes: 'Agosto', nome: 'Agosto Dourado', cor: '#d4a72c', claro: true, tema: 'Aleitamento materno',
    texto: 'Incentivo ao aleitamento materno, que protege a saúde do bebê e da mãe.' },
  { mes: 'Setembro', nome: 'Setembro Amarelo', cor: '#f5c518', claro: true, tema: 'Prevenção ao suicídio',
    texto: 'Falar é a melhor solução. Se você ou alguém próximo precisa de ajuda, ligue para o CVV 188 (gratuito, 24h) ou acesse cvv.org.br.' },
  { mes: 'Outubro', nome: 'Outubro Rosa', cor: '#c2386f', tema: 'Câncer de mama',
    texto: 'Prevenção e diagnóstico precoce do câncer de mama. Faça o autoexame e mantenha a mamografia em dia.' },
  { mes: 'Novembro', nome: 'Novembro Azul', cor: '#1d4e89', tema: 'Saúde do homem',
    texto: 'Cuidado com a saúde do homem e prevenção ao câncer de próstata. Consulte um médico regularmente.' },
  { mes: 'Dezembro', nome: 'Dezembro Vermelho', cor: '#b3202a', tema: 'HIV/AIDS',
    texto: 'Prevenção ao HIV/AIDS e outras ISTs. Faça o teste: é gratuito no SUS, e o tratamento também.' },
];
const campanhaAtual = () => CAMPANHAS[S.perfil && S.perfil.ativo && S.mes ? Number(S.mes.slice(5, 7)) - 1 : new Date().getMonth()];
function seloCampanha() {
  const c = campanhaAtual();
  return `<div class="campanha">
    <button type="button" class="campanha-btn" aria-expanded="false" title="${esc(c.nome)}: ${esc(c.tema)}">
      <span class="laco" style="background:${c.cor}"></span>${esc(c.nome)}</button>
    <div class="campanha-aviso" role="dialog" aria-label="${esc(c.nome)}">
      <div class="campanha-topo" style="background:${c.cor};color:${c.claro ? '#1f2937' : '#fff'}">🎗 ${esc(c.nome)}</div>
      <div class="campanha-corpo"><b>${esc(c.tema)}</b><p>${esc(c.texto)}</p></div>
    </div></div>`;
}
function ligarCampanha(raiz = document) {
  const box = $('.campanha', raiz); if (!box) return;
  const btn = $('.campanha-btn', box);
  btn.onclick = e => { e.stopPropagation(); const ab = box.classList.toggle('aberta'); btn.setAttribute('aria-expanded', ab); };
  $('.campanha-aviso', box).onclick = e => e.stopPropagation();
}
const fecharCampanha = () => $$('.campanha.aberta').forEach(b => { b.classList.remove('aberta'); $('.campanha-btn', b).setAttribute('aria-expanded', 'false'); });
document.addEventListener('click', fecharCampanha);
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharCampanha(); });

// --------------------------------------------------------------- fluxo de login
let iniciado = false;
const VERSAO = '20261118e';
let versaoNova = null;
async function conferirVersao() {
  try {
    const r = await fetch(`versao.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const v = String((await r.json()).versao || '');
    if (!v || v === VERSAO) return;
    let ja = null; try { ja = sessionStorage.getItem('recarregouPara'); } catch {}
    if (ja === v) return;
    versaoNova = v; aplicarVersao();
  } catch {}
}
function aplicarVersao() {
  if (!versaoNova) return;
  if (document.querySelector('.overlay')) { avisoVersao(); return; }
  try { sessionStorage.setItem('recarregouPara', versaoNova); } catch {}
  const u = new URL(location.href); u.searchParams.set('v', versaoNova);
  location.replace(u.toString());
}
function avisoVersao() {
  if (avisoVersao.ligado) return; avisoVersao.ligado = true;
  const obs = new MutationObserver(() => { if (!document.querySelector('.overlay')) { obs.disconnect(); avisoVersao.ligado = false; aplicarVersao(); } });
  obs.observe(document.body, { childList: true });
}
if (new URL(location.href).searchParams.has('v')) { const u = new URL(location.href); u.searchParams.delete('v'); history.replaceState(null, '', u.toString()); }

// --------------------------------------------------------------- créditos
function creditos() {
  modal('🎉 Você achou os créditos!', `<div class="creditos">
      <div class="cred-logo"><i></i></div>
      <h3>Atendimento Field</h3>
      <p>Sistema de atendimentos técnicos</p>
      <p class="cred-autor">Idealizado por <b>Emerson Araujo</b> e <b>Matheus Motta</b><br>Equipe de Atibaia e Bragança Paulista · ${new Date().getFullYear()}</p>
      <p class="hint">Versão ${esc(VERSAO)}</p>
    </div>`, [{ t: 'Fechar', primary: true }], 'sm');
}
creditos.cliques = 0; creditos.ultimo = 0;

// --------------------------------------------------------------- exclusão em massa e Lixeira
const DIAS_LIXEIRA = 30;
function excluirEmMassa(itens, depois) {
  if (!itens.length) return;
  const n = itens.length;
  modal(`Excluir ${n} chamado(s)`, `<form novalidate><div id="e"></div>
    <p style="margin-top:0">Os chamados abaixo vão para a <b>Lixeira</b>: saem das telas, do painel e do Excel. Você pode <b>restaurar em até ${DIAS_LIXEIRA} dias</b>; depois disso são apagados de vez.</p>
    <div class="lista-excluir">${itens.slice(0, 40).map(a => `<div><b class="mono">${esc(a.smax || '—')}</b> · ${esc(a.comarca)} · ${fmtData(a.data_ref)} · ${esc(nomeDe(a.uid, a.tecnico))} · ${chip(a.status)}</div>`).join('')}${n > 40 ? `<div class="muted">… e mais ${n - 40}</div>` : ''}</div>
    <label class="f" style="margin-top:12px"><span>Para confirmar, digite <b>${n}</b></span><input name="conf" inputmode="numeric" autocomplete="off" placeholder="${n}"></label>
  </form>`, [{ t: 'Cancelar' }, { t: `🗑 Excluir ${n}`, danger: true, fn: async ov => {
    if (s($('input[name=conf]', ov).value) !== String(n)) { erroBox($('#e', ov), `Digite ${n} para confirmar.`); return false; }
    try {
      await api.moverParaLixeira(itens.map(a => a.id), S.perfil.nome, agoraLocal());
      itens.forEach(a => esquecerNoCache(a.id));
      toast(`${n} chamado(s) movido(s) para a Lixeira.`); if (depois) depois(); return true;
    } catch (e) { erroBox($('#e', ov), e.message); return false; }
  } }], 'sm');
}
async function telaLixeira() {
  let l; try { l = await api.listarLixeira(); } catch (e) { return toast(e.message, true); }
  const limite = Date.now() - DIAS_LIXEIRA * 86400000;
  const vencidos = l.filter(a => new Date(a.lixeira.em).getTime() < limite);
  if (vencidos.length) { try { await api.excluirDefinitivo(vencidos.map(a => a.id)); } catch {} l = l.filter(a => !vencidos.includes(a)); }
  l.sort((a, b) => (b.lixeira.em || '').localeCompare(a.lixeira.em || ''));
  const diasRest = a => Math.max(0, Math.ceil((new Date(a.lixeira.em).getTime() + DIAS_LIXEIRA * 86400000 - Date.now()) / 86400000));
  const marc = new Set();
  const { ov, fechar } = modal(`🗑 Lixeira (${l.length})`, `<div id="e"></div>${l.length ? `
    <p class="hint" style="margin-top:0">Chamados excluídos. Ficam aqui por ${DIAS_LIXEIRA} dias e depois são apagados de vez.</p>
    <div class="tablewrap"><table><thead><tr><th class="col-sel"><input type="checkbox" id="lxTodos"></th><th>SMAX</th><th>Comarca</th><th>Data</th><th>Técnico</th><th>Status</th><th>Excluído por</th><th class="num">Some em</th></tr></thead><tbody>
    ${l.map(a => `<tr><td class="col-sel"><input type="checkbox" data-lx="${esc(a.id)}"></td><td class="mono"><b>${esc(a.smax || '—')}</b></td><td>${esc(a.comarca)}</td><td>${fmtData(a.data_ref)}</td><td>${esc(nomeDe(a.uid, a.tecnico))}</td><td>${chip(a.status)}</td>
      <td>${esc(a.lixeira.por || '')} <span class="muted">${fmtDH((a.lixeira.em || '').slice(0, 16))}</span></td><td class="num">${diasRest(a)} dia(s)</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">A Lixeira está vazia.</div>'}`, l.length ? [
    { t: 'Apagar de vez', danger: true, fn: async () => {
      const ids = marc.size ? [...marc] : l.map(a => a.id);
      if (!confirm(`Apagar DE VEZ ${ids.length} chamado(s)${marc.size ? ' marcados' : ' (a Lixeira inteira)'}? Isso não pode ser desfeito.`)) return false;
      try { await api.excluirDefinitivo(ids); toast(`${ids.length} chamado(s) apagado(s) de vez.`); return true; } catch (e) { toast(e.message, true); return false; }
    } },
    { t: 'Fechar' },
    { t: '↩ Restaurar marcados', primary: true, fn: async ov2 => {
      if (!marc.size) { erroBox($('#e', ov2), 'Marque os chamados que quer restaurar.'); return false; }
      try { await api.restaurarDaLixeira([...marc]); toast(`${marc.size} chamado(s) restaurado(s).`); refresh(); return true; } catch (e) { toast(e.message, true); return false; }
    } },
  ] : [{ t: 'Fechar', primary: true }], 'lg');
  if (!l.length) return;
  const atualiza = () => { const b = $$('footer button', ov); b[0].textContent = marc.size ? `Apagar de vez (${marc.size})` : 'Esvaziar Lixeira'; b[2].textContent = `↩ Restaurar marcados${marc.size ? ` (${marc.size})` : ''}`; };
  $$('input[data-lx]', ov).forEach(cb => cb.onchange = () => { cb.checked ? marc.add(cb.dataset.lx) : marc.delete(cb.dataset.lx); $('#lxTodos', ov).checked = marc.size === l.length; atualiza(); });
  $('#lxTodos', ov).onchange = e => { $$('input[data-lx]', ov).forEach(cb => { cb.checked = e.target.checked; cb.checked ? marc.add(cb.dataset.lx) : marc.delete(cb.dataset.lx); }); atualiza(); };
  atualiza();
}

// --------------------------------------------------------------- cache dos chamados do mês
const MARGEM_RELOGIO = 10 * 60 * 1000;
S.cache = { mes: null, docs: null, quando: 0 };
const doMes = (d, mes) => d.mes === mes || (Array.isArray(d.meses) && d.meses.includes(mes));
async function docsDoMes(mes, completo) {
  const c = S.cache;
  if (completo || c.mes !== mes || !c.docs) {
    const inicio = Date.now();
    const l = await api.listarAtendimentos({ mes });
    S.cache = { mes, docs: new Map(l.map(d => [d.id, d])), quando: inicio };
    return l.filter(foraDaLixeira);
  }
  const inicio = Date.now();
  const alt = await api.listarAlteradosDesde(new Date(c.quando - MARGEM_RELOGIO));
  alt.forEach(d => { if (doMes(d, mes)) c.docs.set(d.id, d); else c.docs.delete(d.id); });
  c.quando = inicio;
  return [...c.docs.values()].filter(foraDaLixeira);
}
const foraDaLixeira = d => !d.lixeira;
const doTecnico = (l, uid) => uid ? l.filter(x => x.uid === uid || (Array.isArray(x.uids) && x.uids.includes(uid))) : l;
function esquecerNoCache(id) { if (S.cache.docs) S.cache.docs.delete(id); }

// --------------------------------------------------------------- botão ↻ Atualizar
const TELAS_ATU = ['atendimentos', 'agenda', 'painel'];
let ultimaAtu = Date.now(), atualizando = false;
const botaoAtu = () => `<span class="atu"><button class="btn" id="atu" title="Busca o que a equipe registrou e confere se saiu versão nova do sistema">↻ Atualizar</button></span>`;
function marcarHora() { ultimaAtu = Date.now(); }
async function versaoMudou() {
  try {
    const r = await fetch(`versao.json?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) return null;
    const v = String((await r.json()).versao || ''); return v && v !== VERSAO ? v : null;
  } catch { return null; }
}
async function atualizarTela(manual) {
  const r = rota();
  if (atualizando || !S.perfil || !S.perfil.ativo || !TELAS_ATU.includes(r)) return;
  if (!manual && (document.querySelector('.overlay') || document.visibilityState !== 'visible')) return;
  atualizando = true; const b = $('#atu'); if (b) { b.disabled = true; b.textContent = '↻ Atualizando…'; }
  try {
    if (manual) {
      const v = await versaoMudou();
      if (v) { let ja = null; try { ja = sessionStorage.getItem('recarregouPara'); } catch {} if (ja !== v) { versaoNova = v; aplicarVersao(); return; } }
      try { S.usuarios = await api.listarUsuarios(); } catch {}
    }
    const y = scrollY, main = $('main');
    if (r === 'atendimentos' && S.recarregar) await S.recarregar(manual);
    else if (r === 'painel') { if (manual) { await docsDoMes(S.mes, true); await telaPainel(main); } else if (await mudou('painel')) await telaPainel(main); }
    else if (r === 'agenda') { if (manual || await mudou('agenda')) await telaAgenda(main); }
    scrollTo(0, y); ligarAtu(); marcarHora();
    if (manual) toast('Informações atualizadas.');
  } catch (e) { if (manual) toast(e.message, true); }
  finally { atualizando = false; const b2 = $('#atu'); if (b2) { b2.disabled = false; b2.textContent = '↻ Atualizar'; } }
}
async function mudou(tela) {
  try {
    const l = tela === 'painel' ? await docsDoMes(S.mes) : (await api.listarAgendados({ uid: isAdmin() ? null : S.perfil.id })).filter(foraDaLixeira);
    const ass = assinatura(l), k = 'assin_' + tela, antes = S[k]; S[k] = ass; return antes !== ass;
  } catch { return false; }
}
const assinatura = l => JSON.stringify(l.map(x => [x.id, x.status, x.inicio, x.termino, x.agendamento, x.comarca, x.encaminhado_para, (x.idas || []).length, x.uid]).sort());
function ligarAtu() { const b = $('#atu'); if (b) b.onclick = () => atualizarTela(true); marcarHora(); }
setInterval(() => atualizarTela(false), 2 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - ultimaAtu > 30 * 1000) atualizarTela(false); });

api.aoMudarLogin(async conta => {
  S.conta = conta; S.perfil = null; S.usuarios = null; S.erroPerfil = null; S.filtros.tecnico = null;
  if (conta) S.telaAuth = 'entrar';
  if (conta && conta.verificado && emailDaEmpresa(conta.email)) {
    try {
      S.perfil = await api.meuPerfil();
      if (!S.perfil) S.perfil = await api.criarMeuPerfil(conta.nome || conta.email.split('@')[0]);
    } catch (e) {
      S.erroPerfil = e.message;
    }
  }
  if (!iniciado) { window.addEventListener('hashchange', render); iniciado = true; }
  render();
});

function rota() { return (location.hash.replace(/^#\/?/, '') || 'atendimentos').split('?')[0]; }

async function render() {
  if (!S.conta) return telaAuth();
  if (!emailDaEmpresa(S.conta.email)) return telaBloqueio('Conta sem acesso', `Você entrou como <b>${esc(S.conta.email)}</b>. Só e-mails ${api.DOMINIOS.map(d => '@' + d).join(' ou ')} têm acesso.`);
  if (!S.conta.verificado) return telaVerificar();
  if (!S.perfil) return telaBloqueio('Não foi possível carregar seu acesso', S.erroPerfil || 'Tente sair e entrar de novo.');
  if (S.perfil.desligado) return telaBloqueio('Acesso encerrado', 'Sua conta foi desligada da equipe. Se isso for um engano, fale com o líder.');
  if (!S.perfil.ativo) return telaBloqueio('Aguardando liberação', `Sua conta (${esc(S.conta.email)}) foi criada. Avise o líder da equipe para liberar seu acesso em <b>Usuários</b>. Depois é só recarregar esta página.`, true);
  if (!S.usuarios) { try { S.usuarios = await api.listarUsuarios(); } catch (e) { toast(e.message, true); S.usuarios = [S.perfil]; } }
  if (!S.comarcasOficiais) { try { S.comarcasOficiais = await api.lerComarcas(); } catch (e) { S.comarcasOficiais = []; } }
  const r = rota();
  layout(r);
  const main = $('main');
  S.assin_painel = S.assin_agenda = undefined;
  let t;
  if (r === 'painel') t = telaPainel(main);
  else if (r === 'agenda') t = telaAgenda(main);
  else if (r === 'usuarios' && isAdmin()) return telaUsuarios(main);
  else t = telaAtendimentos(main);
  ligarAtu(); return t;
}

function authShell(inner) {
  app.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-cab"><div class="brandmark"><i></i>Atendimento Field</div>${seloCampanha()}</div>${inner}</div></div>`;
  ligarCampanha(app);
}

function telaAuth() {
  const t = S.telaAuth;
  const doms = api.DOMINIOS.map(x => '@' + x).join(' ou ');
  if (t === 'criar') {
    authShell(`<h1>Criar conta</h1><p class="sub">Use seu e-mail da empresa (${esc(doms)}). Você vai receber um link no Outlook para confirmar.</p>
      <form id="f" novalidate><div id="e"></div>
        <label class="f"><span>Seu nome (como aparece no painel)</span><input type="text" name="nome" required autofocus></label>
        <label class="f"><span>E-mail da empresa</span><input type="email" name="email" placeholder="${esc(dominioTxt())}" autocomplete="username" required></label>
        <label class="f"><span>Senha</span><input type="password" name="senha" autocomplete="new-password" required><div class="hint">Mínimo de 8 caracteres, com letras e números. Use uma senha só para este sistema.</div></label>
        <label class="f"><span>Repita a senha</span><input type="password" name="senha2" autocomplete="new-password" required></label>
        <button class="btn primary block" type="submit">Criar conta</button>
        <p class="hint" style="margin-top:14px">Já tem conta? <a href="#" data-ir="entrar">Entrar</a></p></form>`);
    $('#f').onsubmit = async ev => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); const e = $('#e');
      if (!d.nome.trim()) return erroBox(e, 'Informe seu nome.');
      if (!emailDaEmpresa(d.email)) return erroBox(e, `Use o e-mail da empresa (${doms}).`);
      const f = senhaFraca(d.senha); if (f) return erroBox(e, f);
      if (d.senha !== d.senha2) return erroBox(e, 'As senhas não conferem.');
      const b = $('button[type=submit]', ev.target); b.disabled = true;
      try { await api.criarConta(d.nome, d.email, d.senha); toast('Conta criada. Confira seu e-mail.'); }
      catch (er) { erroBox(e, er.message); b.disabled = false; }
    };
  } else if (t === 'esqueci') {
    authShell(`<h1>Esqueci minha senha</h1><p class="sub">Enviaremos um link para você criar uma nova senha.</p>
      <form id="f" novalidate><div id="e"></div>
        <label class="f"><span>E-mail da empresa</span><input type="email" name="email" placeholder="${esc(dominioTxt())}" required autofocus></label>
        <button class="btn primary block" type="submit">Enviar link</button>
        <p class="hint" style="margin-top:14px"><a href="#" data-ir="entrar">Voltar para o login</a></p></form>`);
    $('#f').onsubmit = async ev => {
      ev.preventDefault(); const email = new FormData(ev.target).get('email');
      try { await api.esqueciSenha(email); $('#e').innerHTML = `<div class="err ok">Se esse e-mail tiver conta, o link chegou nele. Confira também o lixo eletrônico.</div>`; }
      catch (er) { erroBox($('#e'), er.message); }
    };
  } else {
    authShell(`<h1>Entrar</h1><p class="sub">Use seu e-mail da empresa e a senha do sistema.</p>
      <form id="f" novalidate><div id="e"></div>
        <label class="f"><span>E-mail</span><input type="email" name="email" autocomplete="username" placeholder="${esc(dominioTxt())}" required autofocus></label>
        <label class="f"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
        <button class="btn primary block" type="submit">Entrar</button>
        <p class="hint" style="margin-top:14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <a href="#" data-ir="esqueci">Esqueci minha senha</a><a href="#" data-ir="criar">Primeiro acesso? Criar conta</a></p></form>`);
    $('#f').onsubmit = async ev => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
      const b = $('button[type=submit]', ev.target); b.disabled = true;
      try { await api.entrar(d.email, d.senha); } catch (er) { erroBox($('#e'), er.message); b.disabled = false; }
    };
  }
  $$('[data-ir]').forEach(a => a.onclick = ev => { ev.preventDefault(); S.telaAuth = a.dataset.ir; telaAuth(); });
}

function telaVerificar() {
  authShell(`<h1>Confirme seu e-mail</h1>
    <p class="sub">Enviamos um link para <b>${esc(S.conta.email)}</b>. Abra o e-mail (veja também o lixo eletrônico), clique no link e depois volte aqui.</p>
    <div id="e"></div>
    <button class="btn primary block" id="ja">Já confirmei</button>
    <p class="hint" style="margin-top:14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <a href="#" id="reenv">Reenviar e-mail</a><a href="#" id="sair">Sair</a></p>`);
  $('#ja').onclick = async () => {
    try {
      if (await api.conferirVerificacao()) {
        S.conta.verificado = true;
        S.perfil = await api.meuPerfil() || await api.criarMeuPerfil(S.conta.nome || S.conta.email.split('@')[0]);
        render();
      } else erroBox($('#e'), 'Ainda não aparece como confirmado. Clique no link do e-mail e tente de novo.');
    } catch (er) { erroBox($('#e'), er.message); }
  };
  $('#reenv').onclick = async ev => { ev.preventDefault(); try { await api.reenviarVerificacao(); toast('E-mail reenviado.'); } catch (er) { toast(er.message, true); } };
  $('#sair').onclick = ev => { ev.preventDefault(); api.sair(); };
}

function telaBloqueio(titulo, msg, recarregar) {
  authShell(`<h1>${titulo}</h1><p class="sub">${msg}</p>
    ${recarregar ? '<button class="btn primary block" id="rec">Recarregar</button>' : ''}
    <p class="hint" style="margin-top:14px"><a href="#" id="sair">Sair</a></p>`);
  if (recarregar) $('#rec').onclick = () => location.reload();
  $('#sair').onclick = ev => { ev.preventDefault(); api.sair(); };
}

// --------------------------------------------------------------- layout
function layout(r) {
  const tabs = [['atendimentos', isAdmin() ? 'Atendimentos' : 'Meus atendimentos'], ['agenda', 'Agenda'], ['painel', 'Painel']];
  if (isAdmin()) {
    const pend = S.usuarios.filter(u => !u.ativo && !u.bloqueado && !u.desligado).length;
    tabs.push(['usuarios', `Usuários${pend ? ` <span class="badge">${pend}</span>` : ''}`]);
  }
  const atual = tabs.some(x => x[0] === r) ? r : 'atendimentos';
  app.innerHTML = `
  <header class="top ${campanhaAtual().claro ? 'claro' : ''}" style="--top:${campanhaAtual().cor}"><div class="top-in">
    <a class="brandmark" href="#/atendimentos" id="logoInicio" title="Ir para a tela principal"><i></i><span>Atendimento Field</span></a>
    ${seloCampanha()}
    <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/${k}" class="${atual === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <div class="me">
      <button id="meBtn" aria-haspopup="true"><span class="avatar">${esc(iniciais(S.perfil.nome))}</span><span class="nm">${esc(S.perfil.nome.split(' ')[0])}</span></button>
      <div class="menu" id="meMenu">
        <div class="who"><b>${esc(S.perfil.nome)}</b><small>${esc(S.perfil.email)}</small><small>${isAdmin() ? 'Líder / administrador' : 'Técnico'}</small></div>
        <button id="mSenha">Trocar senha</button>
        <button id="mSair">Sair</button>
      </div>
    </div>
  </div></header>
  <main></main>`;
  $('#meBtn').onclick = e => { e.stopPropagation(); $('#meMenu').classList.toggle('open'); };
  document.onclick = () => $('#meMenu') && $('#meMenu').classList.remove('open');
  ligarCampanha($('header.top'));
  $('#logoInicio').onclick = e => {
    const t = Date.now(); creditos.cliques = (t - creditos.ultimo < 1500 ? creditos.cliques : 0) + 1; creditos.ultimo = t;
    if (creditos.cliques >= 10) { e.preventDefault(); creditos.cliques = 0; return creditos(); }
    if (rota() === 'atendimentos') { e.preventDefault(); scrollTo(0, 0); if (creditos.cliques === 1) render(); }
  };
  $('#mSair').onclick = () => api.sair();
  $('#mSenha').onclick = trocarSenha;
}

function trocarSenha() {
  modal('Trocar senha', `<form novalidate><div id="e"></div>
      <label class="f"><span>Senha atual</span><input type="password" name="atual" autocomplete="current-password"></label>
      <label class="f"><span>Nova senha</span><input type="password" name="nova" autocomplete="new-password"><div class="hint">Mínimo de 8 caracteres, com letras e números.</div></label>
      <label class="f"><span>Repita a nova senha</span><input type="password" name="nova2" autocomplete="new-password"></label></form>`,
  [{ t: 'Cancelar' }, { t: 'Salvar', primary: true, fn: async ov => {
    const d = Object.fromEntries(new FormData($('form', ov))); const e = $('#e', ov);
    const f = senhaFraca(d.nova); if (f) { erroBox(e, f); return false; }
    if (d.nova !== d.nova2) { erroBox(e, 'As senhas não conferem.'); return false; }
    try { await api.trocarSenha(d.atual, d.nova); toast('Senha alterada.'); return true; } catch (er) { erroBox(e, er.message); return false; }
  } }], 'sm');
}

// --------------------------------------------------------------- modal genérico
function modal(titulo, body, botoes, size = '', aoAbrir) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><header><h3>${titulo}</h3><button class="x" aria-label="Fechar">×</button></header>
    <div class="body">${body}</div><footer>${botoes.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger left' : ''}" data-i="${i}">${b.t}</button>`).join('')}</footer></div>`;
  document.body.appendChild(ov);
  const fechar = () => { ov.remove(); document.removeEventListener('keydown', escK); };
  const escK = e => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', escK);
  $('.x', ov).onclick = fechar;
  ov.addEventListener('mousedown', e => { if (e.target === ov) fechar(); });
  $$('footer button', ov).forEach(btn => btn.onclick = async () => {
    const b = botoes[btn.dataset.i];
    if (!b.fn) return fechar();
    btn.disabled = true;
    const ok = await b.fn(ov);
    btn.disabled = false;
    if (ok !== false) fechar();
  });
  const form = $('form', ov);
  if (form) form.addEventListener('submit', e => { e.preventDefault(); const p = botoes.findIndex(b => b.primary); if (p >= 0) $(`footer button[data-i="${p}"]`, ov).click(); });
  if (aoAbrir) aoAbrir(ov, fechar);
  const first = $('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])', ov); if (first) first.focus();
  return { ov, fechar };
}

// --------------------------------------------------------------- Atendimentos
async function telaAtendimentos(main) {
  const admin = isAdmin();
  if (S.filtros.tecnico === null) S.filtros.tecnico = admin ? '' : S.perfil.id;
  const equipe = S.usuarios.filter(u => u.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
  main.innerHTML = `
    <div class="head"><div><h2>${admin ? 'Atendimentos da equipe' : 'Atendimentos'}</h2><p>${esc(nomeMes(S.mes))}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${botaoAtu()}
        ${admin ? '<button class="btn" id="btnLixeira" title="Chamados excluídos (dá para restaurar)">🗑 Lixeira</button>' : ''}
        <button class="btn" id="exp">Exportar Excel</button>
        <button class="btn primary" id="novo">+ Novo atendimento</button>
      </div></div>
    <div id="migr"></div>
    <div class="kpis" id="kpis"></div>
    <div class="toolbar">
      <input type="month" id="fMes" value="${S.mes}" aria-label="Mês">
      <select id="fDia" aria-label="Dia"><option value="">Todos os dias</option></select>
      ${S.mes === mesAtual() ? '<button type="button" class="btn" id="fHoje">Hoje</button>' : ''}
      <input type="search" id="fQ" placeholder="Buscar SMAX, comarca, ticket, usuário…" value="${esc(S.filtros.q)}">
      <select id="fSt" aria-label="Status"><option value="">Todos os status</option>${[...STATUS, 'DEVOLVIDO'].map(x => `<option ${S.filtros.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      ${admin ? `<select id="fTec" aria-label="Técnico"><option value="">Todos os técnicos</option>${equipe.map(t => `<option value="${t.id}" ${S.filtros.tecnico === t.id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select>` : ''}
    </div>
    ${admin ? '<div class="acoes-sel" id="acoesSel" hidden></div>' : ''}
    <div class="card"><div class="tablewrap" id="tab"><div class="empty">Carregando…</div></div></div>`;
  $('#novo').onclick = () => formAtendimento(null);
  if (admin) $('#btnLixeira').onclick = () => telaLixeira();
  const sel = new Set();
  $('#exp').onclick = exportarExcel;
  $('#fMes').onchange = e => { if (e.target.value) { S.mes = e.target.value; S.filtros.dia = ''; render(); } };
  if (S.filtros.dia && S.filtros.dia.slice(0, 7) !== S.mes) S.filtros.dia = '';
  function barraSel(lista) {
    const el = $('#acoesSel'); if (!el) return;
    [...sel].forEach(id => { if (!base.some(a => a.id === id)) sel.delete(id); });
    el.hidden = !sel.size; if (!sel.size) return;
    const fora = [...sel].filter(id => !lista.some(a => a.id === id)).length;
    el.innerHTML = `<b>${sel.size}</b> chamado(s) selecionado(s)${fora ? ` <span class="muted">(${fora} fora dos filtros atuais)</span>` : ''}
      <button class="btn sm danger" id="selExcluir">🗑 Excluir selecionados</button><button class="btn sm" id="selLimpar">Limpar seleção</button>`;
    $('#selLimpar').onclick = () => { sel.clear(); mostrar(); };
    $('#selExcluir').onclick = () => excluirEmMassa(base.filter(a => sel.has(a.id)), () => { sel.clear(); carregar(); });
  }
  $('#fDia').onchange = e => { S.filtros.dia = e.target.value; mostrar(); };
  if ($('#fHoje')) $('#fHoje').onclick = () => { S.filtros.dia = hojeISO(); mostrar(); };
  let deb; $('#fQ').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { S.filtros.q = e.target.value; mostrar(); }, 200); };
  $('#fSt').onchange = e => { S.filtros.status = e.target.value; mostrar(); };
  if ($('#fTec')) $('#fTec').onchange = e => { S.filtros.tecnico = e.target.value; carregar(); };

  let base = [];
  async function carregar(completo) {
    try { 
      let docs = await docsDoMes(S.mes, completo);
      // Aplicar estritamente o filtro de perfil: técnicos comuns veem apenas os seus próprios chamados
      docs = filtrarChamadosPorPerfil(docs);
      base = ordenar(doTecnico(docs, admin ? (S.filtros.tecnico || null) : S.perfil.id)); 
    }
    catch (e) { toast(e.message, true); base = []; }
    S.comarcas = [...new Set([...(S.comarcas || []), ...base.map(a => a.comarca).filter(Boolean)])];
    mostrar();
  }
  function opcoesDias() {
    const [y, m] = S.mes.split('-').map(Number), n = new Date(y, m, 0).getDate();
    const cont = {}; explodir(base, S.mes).forEach(a => { cont[a.data_ref] = (cont[a.data_ref] || 0) + 1; });
    const sem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    let html = '<option value="">Todos os dias</option>';
    for (let d = 1; d <= n; d++) {
      const iso = `${S.mes}-${String(d).padStart(2, '0')}`, q = cont[iso] || 0;
      html += `<option value="${iso}" ${S.filtros.dia === iso ? 'selected' : ''}>${String(d).padStart(2, '0')}/${S.mes.slice(5, 7)} (${sem[new Date(y, m - 1, d).getDay()]}${q ? ` — ${q}` : ''})</option>`;
    }
    $('#fDia').innerHTML = html;
  }
  function mostrar() {
    opcoesDias();
    const q = S.filtros.q.trim().toLowerCase();
    let lista = base;
    if (S.filtros.dia) lista = lista.filter(a => explodir([a]).some(x => x.data_ref === S.filtros.dia));
    if (S.filtros.status) lista = lista.filter(a => a.status === S.filtros.status);
    if (q) lista = lista.filter(a => [a.smax, a.comarca, a.ticket_softplan, a.usuario_atendido, a.obs].some(v => (v || '').toLowerCase().includes(q)));
    const c = k => lista.filter(a => a.status === k).length;
    $('#kpis').innerHTML = `
      <div class="kpi enc"><span>Encaminhado</span><b>${c('ENCAMINHADO')}</b></div>
      <div class="kpi tent"><span>Tent. contato</span><b>${c('TENT CONTATO')}</b></div>
      <div class="kpi ag"><span>Agendado</span><b>${c('AGENDADO')}</b></div>
      <div class="kpi fech"><span>Fechado</span><b>${c('FECHADO')}</b></div>
      ${c('DEVOLVIDO') ? `<div class="kpi dev" title="Chamados que o setor devolveu e foram reabertos"><span>Devolvido</span><b>${c('DEVOLVIDO')}</b></div>` : ''}
      <div class="kpi"><span>Home / Local</span><b>${lista.filter(a => a.home_local === 'HOME').length} / ${lista.filter(a => a.home_local === 'LOCAL').length}</b></div>
      <div class="kpi tot"><span>Chamados</span><b>${lista.length}</b>${lista.some(a => numIdas(a) > 1) ? `<small class="fora">${lista.reduce((t, a) => t + numIdas(a), 0)} idas no total</small>` : ''}</div>`;
    if (!lista.length) {
      $('#tab').innerHTML = `<div class="empty">Nenhum atendimento ${S.filtros.dia ? 'em ' + fmtData(S.filtros.dia) : 'em ' + esc(nomeMes(S.mes))}${q || S.filtros.status ? ' com esses filtros' : ''}.<br><br><button class="btn primary" id="novo2">+ Registrar atendimento</button></div>`;
      $('#novo2').onclick = () => formAtendimento(null); barraSel(lista); return;
    }
    const mostraTec = admin && S.filtros.tecnico !== S.perfil.id;
    const todosMarcados = lista.length && lista.every(a => sel.has(a.id));
    $('#tab').innerHTML = `<table><thead><tr>
      ${admin ? `<th class="col-sel"><input type="checkbox" id="selTodos" title="Marcar todos os chamados da lista (com os filtros atuais)" ${todosMarcados ? 'checked' : ''}></th>` : ''}<th>Solicitação SMAX</th><th>Comarca</th><th>Início</th><th>Término</th><th class="num" title="Soma das idas do chamado">Tempo</th><th>Ticket Softplan</th><th>Status</th><th>Encaminhado p/</th><th>Home/Local</th>${mostraTec ? '<th>Técnico</th>' : ''}</tr></thead>
      <tbody>${lista.map(a => { const fe = idasFechadas(a), ini = fe.length ? fe[0].inicio : a.inicio, tm = minutosChamado(a), nomes = unicos([...fe.map(x => nomeDe(x.uid, x.tecnico)), nomeDe(a.uid, a.tecnico)]);
        return `<tr class="click ${fe.length ? 'com-idas' : ''} ${sel.has(a.id) ? 'marcado' : ''}" data-id="${esc(a.id)}">
        ${admin ? `<td class="col-sel"><input type="checkbox" data-sel="${esc(a.id)}" ${sel.has(a.id) ? 'checked' : ''} aria-label="Selecionar SMAX ${esc(a.smax)}"></td>` : ''}<td class="mono"><b>${esc(a.smax) || '<span class="muted">—</span>'}</b>${fe.length ? ` <span class="idas" title="Chamado voltou do setor">↺ ${fe.length + 1} idas</span>` : a.ida > 1 ? ` <span class="tag-ida" title="Formato antigo">${ordinal(a.ida)}</span>` : ''}</td>
        <td>${esc(a.comarca)}</td><td>${fmtDH(ini)}</td><td>${fmtDH(a.termino)}</td>
        <td class="num">${fe.length ? `<b>${fmtHM(tm)}</b>` : duracao(a.inicio, a.termino)}</td><td class="mono">${esc(a.ticket_softplan)}</td>
        <td>${chip(a.status)}</td><td>${a.encaminhado_para ? `<span class="tag">${esc(a.encaminhado_para)}</span>` : ''}</td>
        <td>${esc(a.home_local)}</td>${mostraTec ? `<td>${nomes.map(esc).join(' → ')}${marcaDesligado(a.uid)}</td>` : ''}
      </tr>`; }).join('')}</tbody></table>`;
    $$('#tab tr[data-id]').forEach(tr => tr.onclick = () => formAtendimento(lista.find(a => a.id === tr.dataset.id)));
    if (admin) {
      $$('#tab td.col-sel').forEach(td => td.onclick = e => e.stopPropagation());
      $$('#tab input[data-sel]').forEach(cb => cb.onchange = () => { cb.checked ? sel.add(cb.dataset.sel) : sel.delete(cb.dataset.sel); cb.closest('tr').classList.toggle('marcado', cb.checked); $('#selTodos').checked = lista.every(a => sel.has(a.id)); barraSel(lista); });
      $('#selTodos').onchange = e => { lista.forEach(a => e.target.checked ? sel.add(a.id) : sel.delete(a.id)); mostrar(); };
    }
    barraSel(lista);
  }
  S.recarregar = carregar;
  carregar();
  if (admin) avisoFormatoAntigo();
}

async function cadeiasAntigas(todos) {
  const porId = new Map(todos.map(x => [x.id, x])), grupos = new Map();
  todos.filter(x => x.origem && porId.has(x.origem)).forEach(x => { (grupos.get(x.origem) || grupos.set(x.origem, []).get(x.origem)).push(x); });
  return [...grupos.entries()].map(([orig, l]) => [porId.get(orig), ...l.sort((a, b) => (a.ida || 1) - (b.ida || 1) || (a.inicio || '').localeCompare(b.inicio || ''))]);
}
async function avisoFormatoAntigo() {
  if (S.migrVisto) return; S.migrVisto = true;
  let todos; try { if (!(await api.temFormatoAntigo())) return; todos = await api.listarTodosAtendimentos(); } catch { return; }
  const cad = cadeiasAntigas(todos); const el = $('#migr'); if (!cad.length || !el) return;
  el.innerHTML = `<div class="aviso-migr"><div><b>${cad.length} chamado(s) reaberto(s) ainda estão no formato antigo</b> (uma linha por ida): ${cad.slice(0, 6).map(c => esc(c[0].smax)).join(', ')}${cad.length > 6 ? '…' : ''}.<br><span class="hint">Juntar deixa cada um como um chamado só, com as idas dentro. Horários, técnicos e histórico são mantidos.</span></div>
    <button class="btn primary sm" id="btnMigr">Juntar agora</button></div>`;
  $('#btnMigr').onclick = async () => {
    if (!confirm(`Juntar ${cad.length} chamado(s)? Cada um vira um registro só, com as idas dentro.`)) return;
    try { for (const c of cad) await juntarCadeia(c); toast(`${cad.length} chamado(s) juntados.`); el.innerHTML = ''; refresh(); }
    catch (e) { toast(e.message, true); }
  };
}
async function juntarCadeia(cad) {
  const idas = cad.slice(0, -1).map((x, i) => {
    const prox = cad[i + 1], enc = {};
    CAMPOS_IDA.forEach(k => { enc[k] = x[k] ?? ''; });
    if (x.status === 'DEVOLVIDO') { const h = [...(x.historico || [])].reverse().find(e => e.para === 'DEVOLVIDO'); enc.status = (h && h.de) || 'ENCAMINHADO'; }
    enc.devolucao = x.devolucao || { setor: x.encaminhado_para || '', motivo: 'não informado', em: prox.inicio || '', por: prox.tecnico || '' };
    return enc;
  });
  const ult = cad[cad.length - 1], novo = {};
  Object.keys(ult).forEach(k => { if (!['id', 'ida', 'origem', 'devolucao', 'criado_em', 'atualizado_em', 'idas', 'meses', 'uids'].includes(k)) novo[k] = ult[k]; });
  novo.smax = cad[0].smax; novo.idas = idas;
  novo.historico = cad.flatMap(x => x.historico || []).sort((a, b) => (a.em || '').localeCompare(b.em || '')).slice(-300);
  novo.meses = mesesDe(idas, novo); novo.uids = uidsDe(idas, novo);
  if (cad[0].criado_em) novo.criado_em = cad[0].criado_em;
  await api.substituirAtendimento(cad[0].id, novo);
  for (const x of cad.slice(1)) { await api.excluirAtendimento(x.id); esquecerNoCache(x.id); }
}
const desligado = uid => !!((S.usuarios || []).find(x => x.id === uid) || {}).desligado;
const marcaDesligado = uid => desligado(uid) ? ' <span class="tag-deslig">desligado</span>' : '';
function nomeDe(uid, reserva) { const u = (S.usuarios || []).find(x => x.id === uid); return u ? u.nome : (reserva || '—'); }

const CAMPOS_IDA = ['uid', 'tecnico', 'inicio', 'termino', 'status', 'encaminhado_para', 'home_local', 'agendamento', 'agendamento_fim', 'dia_inteiro', 'juri', 'usuario_atendido', 'obs', 'data_ref', 'mes'];
const idasFechadas = doc => Array.isArray(doc.idas) ? doc.idas : [];
const numIdas = doc => idasFechadas(doc).length + 1;
const parado = ida => { const de = ida.termino || ida.inicio, ate = ida.devolucao && ida.devolucao.em; if (!de || !ate) return null; const m = Math.round((new Date(ate) - new Date(de)) / 60000); return isNaN(m) || m < 0 ? null : m; };
function explodir(docs, mes) {
  const out = [];
  docs.forEach(doc => {
    const base = { smax: doc.smax, comarca: doc.comarca, ticket_softplan: doc.ticket_softplan, id: doc.id, _doc: doc };
    const fe = idasFechadas(doc);
    fe.forEach((x, i) => out.push({ ...base, ...x, _ida: i + 1, _fechada: true, _statusOrig: x.status, status: x.devolucao ? 'DEVOLVIDO' : x.status, _reaberto: i > 0 && !!fe[i - 1].devolucao }));
    out.push({ ...doc, _doc: doc, _ida: fe.length + (doc.ida || 1), _reaberto: fe.length ? !!fe[fe.length - 1].devolucao : (doc.ida || 1) > 1 });
  });
  return mes ? out.filter(x => x.mes === mes) : out;
}
const unicos = l => [...new Set(l.filter(Boolean))];
const mesesDe = (idas, at) => unicos([...idas.map(x => x.mes), at.mes]);
const uidsDe = (idas, at) => unicos([...idas.map(x => x.uid), at.uid]);
function minutosChamado(doc) { return explodir([doc]).map(minutosDe).filter(m => m !== null).reduce((t, m) => t + m, 0); }
const fmtHM = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
function blocoIdas(doc, encerrando) {
  const fech = idasFechadas(doc); if (!fech.length && !encerrando) return '';
  const tAt = minutosChamado(doc), tPar = fech.map(parado).filter(m => m !== null).reduce((t, m) => t + m, 0);
  const linhaIda = (x, n, atual) => { const m = minutosDe(x); return `<div class="etapa ${atual ? 'atual' : ''}"><div class="n">${n}</div><div>
      <b>${esc(nomeDe(x.uid, x.tecnico))}</b>${x.home_local ? ' · ' + esc(x.home_local) : ''} <span class="lock">${encerrando && x === doc ? '🔒 vai ser encerrada agora' : atual ? '✏️ ida atual (editar abaixo)' : '🔒 encerrada'}</span>
      <small>${fmtDH(x.inicio) || 'sem horário'}${x.termino ? ' → ' + esc((x.termino || '').slice(11, 16)) : ''} · ${chip(x.status)}${x.encaminhado_para ? ` para <span class="tag">${esc(x.encaminhado_para)}</span>` : ''}</small>
      ${x.obs ? `<small>Obs.: ${esc(x.obs)}</small>` : ''}</div><div class="t">${m !== null ? fmtHM(m) : '—'}<small>${x.status === 'TENT CONTATO' ? 'tentativa' : 'atendimento'}</small></div></div>`; };
  const gap = x => { if (!x.devolucao) { if (x.status !== 'AGENDADO') return ''; const rg = x.reagendamento;
      return `<div class="setor agenda-gap">📅 <b>Agendado para ${fmtPeriodo(x)}</b>${x.usuario_atendido ? ' · usuário: ' + esc(x.usuario_atendido) : ''}${rg ? `<br>↻ <b>Reagendado</b> em ${fmtDH(rg.em)} por ${esc(rg.por || '')} para <b>${fmtAgenda(rg.para)}</b>${rg.motivo ? ` · motivo: "${esc(rg.motivo)}"` : ''}` : ''}</div>`; }
    const p = parado(x), d = x.devolucao || {}; return `<div class="setor">⏳ <b>No setor ${esc(d.setor || x.encaminhado_para || '')}${p !== null ? ' por ' + fmtMin(p) : ''}</b>${d.em ? ` · devolvido em ${fmtDH(d.em)}` : ''} · não conta nas horas do técnico${d.motivo ? `<br>Motivo: <b>"${esc(d.motivo)}"</b>` : ''}</div>`; };
  return `<div class="resumo"><div><span>Status atual</span><b>${chip(doc.status)}</b></div><div><span>Tempo de atendimento</span><b>${fmtHM(tAt)}</b></div>
      <div><span>Parado nos setores</span><b style="color:var(--st-dev)">${tPar ? fmtMin(tPar) : '—'}</b></div><div><span>Idas</span><b>${fech.length + 1}</b></div></div>
    <div class="sec">Idas do chamado</div><div class="etapas">${fech.map((x, i) => linhaIda(x, i + 1) + gap(x)).join('')}${linhaIda(doc, fech.length + 1, !encerrando)}</div>
    ${encerrando ? '' : `<div class="sec">Ida atual (${ordinal(fech.length + 1)})</div>`}`;
}

function formAtendimento(a, opts = {}) {
  const chamado = opts.novaIda ? a : null;
  const agend = !!(chamado && opts.agendado);
  const reag = !!(chamado && opts.reagendar);
  const novo = !a;
  const fech = chamado ? idasFechadas(chamado) : (a ? idasFechadas(a) : []);
  if (chamado) a = { inicio: agend ? (chamado.agendamento || agoraLocal()) : agoraLocal(), status: reag ? 'AGENDADO' : '', home_local: agend || reag ? chamado.home_local : '', uid: S.perfil.id, smax: chamado.smax, comarca: chamado.comarca, ticket_softplan: chamado.ticket_softplan, usuario_atendido: chamado.usuario_atendido };
  a = a || { inicio: agoraLocal(), status: '', home_local: '', uid: S.perfil.id };
  const ida = chamado ? fech.length + 2 : fech.length + (a.ida || 1);
  const admin = isAdmin();
  const podeEditar = novo || !!chamado || admin || a.uid === S.perfil.id;
  const dis = podeEditar ? '' : 'disabled';
  const equipe = S.usuarios.filter(u => u.ativo || u.id === a.uid).sort((x, y) => x.nome.localeCompare(y.nome));
  const comarcas = listaComarcas().length ? listaComarcas() : [...new Set((S.comarcas || []).map(tituloComarca))].sort();
  const body = `<form id="fa" novalidate>
    <div id="e"></div>
    ${reag ? `<fieldset class="devol agend"><legend>↻ Reagendar · ${ordinal(ida)}</legend>
      <p class="hint" style="margin-top:0">Estava agendado para <b>${fmtPeriodo(chamado)}</b>${chamado.usuario_atendido ? `, usuário <b>${esc(chamado.usuario_atendido)}</b>` : ''}. Este contato de reagendamento vira uma ida e <b>conta hoje</b> no painel, com o seu horário; o chamado continua AGENDADO para a nova data.</p>
      <div class="row">
        <label class="f"><span>Nova data e hora <em>*</em></span><input type="datetime-local" name="reag_para">${chamado.dia_inteiro ? `<div class="hint">${chamado.juri ? '⚖️ Júri · ' : ''}continua dia inteiro (${DIA_INTEIRO[0]} às ${DIA_INTEIRO[1]}); vale só a data.</div>` : ''}</label>
        <label class="f"><span>Motivo do reagendamento <em>*</em></span><input type="text" name="reag_motivo" list="dlReag" maxlength="200" autocomplete="off" placeholder="Ex.: usuário em audiência">
          <datalist id="dlReag"><option value="Usuário não pôde atender"><option value="Usuário ausente / não atendeu"><option value="Aguardando peça ou equipamento"><option value="Pedido do usuário"></datalist></label>
      </div></fieldset>
      ${blocoIdas(chamado, true)}<div class="sec">Contato de reagendamento (${ordinal(ida)})</div>` : agend ? `<fieldset class="devol agend"><legend>Atender agendamento · ${ordinal(ida)}</legend>
      <p class="hint" style="margin:0">Agendado para <b>${fmtAgenda(chamado.agendamento)}</b>${chamado.usuario_atendido ? `, usuário <b>${esc(chamado.usuario_atendido)}</b>` : ''}. A ida de ${fmtData(chamado.data_ref)} (${esc(nomeDe(chamado.uid, chamado.tecnico))}) fica encerrada como <b>AGENDADO</b> e continua contando em ${esc(nomeMes(chamado.mes))}. Esta nova ida conta no mês em que for atendida, com o horário real.</p></fieldset>
      ${blocoIdas(chamado, true)}<div class="sec">Atendimento (${ordinal(ida)})</div>` : chamado ? `<fieldset class="devol"><legend>Chamado voltou do setor · ${ordinal(ida)}</legend>
      <p class="hint" style="margin-top:0">A ida atual (${fmtData(chamado.data_ref)}, ${esc(nomeDe(chamado.uid, chamado.tecnico))}, ${esc(chamado.status || 'sem status')}${chamado.encaminhado_para ? ' para ' + esc(chamado.encaminhado_para) : ''}) vai ser encerrada e travada. Abaixo você registra a <b>${ordinal(ida)}</b>: conta como mais um atendimento, com o seu horário, no mesmo chamado.</p>
      <div class="row">
        <label class="f"><span>Devolvido por</span><select name="dev_setor">${ENCAMINHADO_PARA.map(x => `<option ${chamado.encaminhado_para === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f"><span>Motivo da devolução <em>*</em></span><input type="text" name="dev_motivo" list="dlMotivos" maxlength="200" autocomplete="off" placeholder="Escreva o motivo (ou escolha uma sugestão)">
          <datalist id="dlMotivos">${MOTIVOS_DEVOLUCAO.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      </div>
      <div class="row"><label class="f"><span>Devolvido em</span><input type="datetime-local" name="dev_em" value="${agoraLocal()}"></label><div class="hint" style="align-self:center">Usado para calcular quanto tempo o chamado ficou parado no setor.</div></div></fieldset>
      ${blocoIdas(chamado, true)}<div class="sec">Nova ida (${ordinal(ida)})</div>` : ''}
    ${!novo && !chamado ? blocoIdas(a) : ''}
    ${!podeEditar ? `<div class="err" style="background:var(--brand-soft);color:var(--brand)">Ida de ${esc(nomeDe(a.uid, a.tecnico))}. Só ele ou o líder podem alterar.${PODE_REABRIR.includes(a.status || '') ? ' Se o chamado voltou do setor, use “Chamado voltou: nova ida”.' : ''}</div>` : ''}
    ${admin ? `<label class="f"><span>Técnico${fech.length || chamado ? ' desta ida' : ''}</span><select name="uid">${equipe.map(t => `<option value="${t.id}" ${a.uid === t.id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>` : ''}
    <div class="row">
      <label class="f"><span>Solicitação SMAX <em>*</em></span><input type="text" name="smax" value="${esc(a.smax)}" placeholder="ex.: 1234567" inputmode="numeric" ${dis} ${chamado || fech.length ? 'readonly' : ''}></label>
      <label class="f"><span>Comarca <em>*</em></span><input type="text" name="comarca" value="${esc(a.comarca)}" list="dlComarcas" autocomplete="off" placeholder="Comece a digitar e escolha na lista" ${dis}></label>
    </div>
    <datalist id="dlComarcas">${comarcas.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="row">
      <label class="f"><span>Início ${chamado || fech.length ? 'desta ida' : 'do atendimento'}</span><div class="with-btn"><input type="datetime-local" name="inicio" value="${esc(a.inicio)}" ${dis}><button type="button" class="btn sm" data-agora="inicio" ${dis}>Agora</button></div></label>
      <label class="f"><span>Término ${chamado || fech.length ? 'desta ida' : 'do atendimento'}</span><div class="with-btn"><input type="datetime-local" name="termino" value="${esc(a.termino)}" ${dis}><button type="button" class="btn sm" data-agora="termino" ${dis}>Agora</button></div><div class="hint" id="dur"></div></label>
    </div>
    <div class="row">
      <label class="f"><span>Ticket Softplan</span><input type="text" name="ticket_softplan" value="${esc(a.ticket_softplan)}" ${dis}></label>
      <label class="f"><span>Encaminhado para</span><select name="encaminhado_para" ${dis}><option value="">—</option>${ENCAMINHADO_PARA.map(x => `<option ${a.encaminhado_para === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <label class="f"><span>Status</span><div class="seg" data-name="status">${(a.status === 'DEVOLVIDO' ? [...STATUS, 'DEVOLVIDO'] : STATUS).map(x => `<button type="button" data-v="${x}" class="${a.status === x ? 'on' : ''}" ${dis}>${x}</button>`).join('')}</div></label>
    <label class="f"><span>Home / Local</span><div class="seg" data-name="home_local">${HOME_LOCAL.map(x => `<button type="button" data-v="${x}" class="${a.home_local === x ? 'on' : ''}" ${dis}>${x === 'HOME' ? 'HOME (remoto)' : 'LOCAL'}</button>`).join('')}</div></label>
    <fieldset class="ag" id="agBox" ${a.status === 'AGENDADO' ? '' : 'hidden'}><legend>Agendamento</legend>
      <div class="chk-ag"><label><input type="checkbox" name="dia_inteiro" ${a.dia_inteiro ? 'checked' : ''} ${dis}> Dia inteiro (${DIA_INTEIRO[0]} às ${DIA_INTEIRO[1]})</label><label><input type="checkbox" name="juri" ${a.juri ? 'checked' : ''} ${dis}> ⚖️ Júri</label></div>
      <div class="row">
        <label class="f"><span>Data</span><input type="date" name="ag_data" value="${esc((a.agendamento || '').slice(0, 10))}" ${dis}></label>
        <div class="row" style="gap:10px">
          <label class="f"><span>Das</span><input type="time" name="ag_ini" value="${esc((a.agendamento || '').slice(11, 16))}" ${dis}></label>
          <label class="f"><span>Até</span><input type="time" name="ag_fim" value="${esc((a.agendamento_fim || '').slice(11, 16))}" ${dis}></label>
        </div>
      </div>
      <label class="f"><span>Usuário (quem será atendido)</span><input type="text" name="usuario_atendido" value="${esc(a.usuario_atendido)}" ${dis}></label>
      <div class="hint" style="margin:-4px 0 8px">Só vira "atrasado" depois do horário final. Sem "Até", vale 1 hora depois do início.</div>
    </fieldset>
    <label class="f"><span>Observações ${chamado || fech.length ? 'desta ida' : 'gerais'}</span><textarea name="obs" rows="2" ${dis}>${esc(a.obs)}</textarea></label>
    <fieldset class="hist">
      <legend>Histórico de status</legend>
      ${podeEditar ? `<label class="f"><span>${novo || chamado ? 'Observação inicial (opcional)' : 'Observação desta alteração'}</span>
        <textarea name="obs_alteracao" rows="2" placeholder="${novo ? 'Ex.: usuário relatou que a impressora não liga.' : 'Ex.: usuário não atendeu, liguei no ramal 2; agendado para amanhã às 9h.'}"></textarea>
        <div class="hint">Fica registrado no histórico com data, hora e o seu nome. ${novo ? '' : 'Mudou o status? Explique aqui o motivo.'}</div></label>` : ''}
      ${linhaDoTempo((chamado || a).historico)}
    </fieldset>
    ${!novo && !chamado ? `<p class="hint">Ida atual registrada por ${esc(nomeDe(a.uid, a.tecnico))}</p>` : ''}
  </form>`;
  const salvar = async ov => {
    const f = $('#fa', ov); const d = Object.fromEntries(new FormData(f));
    $$('.seg', f).forEach(sg => { const on = $('button.on', sg); d[sg.dataset.name] = on ? on.dataset.v : ''; });
    d.dia_inteiro = !!f.dia_inteiro.checked || !!f.juri.checked; d.juri = !!f.juri.checked;
    if (d.dia_inteiro) { d.ag_ini = DIA_INTEIRO[0]; d.ag_fim = DIA_INTEIRO[1]; }
    d.agendamento = d.ag_data ? `${d.ag_data}T${d.ag_ini || DIA_INTEIRO[0]}` : '';
    d.agendamento_fim = d.ag_data && d.ag_fim ? `${d.ag_data}T${d.ag_fim}` : '';
    if (d.status === 'AGENDADO' && !reag && d.agendamento_fim && d.agendamento_fim <= d.agendamento) { erroBox($('#e', ov), 'O horário "Até" precisa ser depois do "Das".'); ov.scrollTop = 0; return false; }
    if (reag) {
      d.reag_motivo = s(d.reag_motivo).slice(0, 200); d.reag_para = normDataHora(d.reag_para);
      if (!d.reag_para) { erroBox($('#e', ov), 'Informe a nova data e hora do agendamento.'); ov.scrollTop = 0; f.reag_para.focus(); return false; }
      if (!d.reag_motivo) { erroBox($('#e', ov), 'Escreva o motivo do reagendamento.'); ov.scrollTop = 0; f.reag_motivo.focus(); return false; }
      d.status = 'AGENDADO'; d.juri = !!chamado.juri; d.dia_inteiro = !!chamado.dia_inteiro;
      if (d.dia_inteiro) { d.agendamento = d.reag_para.slice(0, 11) + DIA_INTEIRO[0]; d.agendamento_fim = d.reag_para.slice(0, 11) + DIA_INTEIRO[1]; }
      else { const dur = chamado.agendamento ? Math.max(15, Math.round((new Date(fimAgenda(chamado)) - new Date(chamado.agendamento)) / 60000)) : 60; d.agendamento = d.reag_para; d.agendamento_fim = somarMin(d.reag_para, dur); }
    }
    if (chamado && !agend && !reag) { d.dev_motivo = s(d.dev_motivo).slice(0, 200); if (!d.dev_motivo) { erroBox($('#e', ov), 'Escreva o motivo da devolução.'); ov.scrollTop = 0; f.dev_motivo.focus(); return false; } }
    const uid = admin && d.uid ? d.uid : (chamado ? S.perfil.id : (a.uid || S.perfil.id));
    const at = montarAtendimento(d, uid, nomeDe(uid, S.perfil.nome));
    if (chamado || fech.length) at.smax = (chamado || a).smax;
    const er = validar(at); if (er) { erroBox($('#e', ov), er); ov.scrollTop = 0; return false; }
    if (listaComarcas().length) {
      const ofi = comarcaOficial(at.comarca);
      if (!ofi) { avisoComarca($('#e', ov), at.comarca, ov); ov.scrollTop = 0; return false; }
      at.comarca = ofi;
    } else at.comarca = tituloComarca(at.comarca);
    if (at.smax && !chamado && (novo || at.smax !== a.smax)) {
      const dup = await smaxDuplicado(at.smax, a.id);
      if (dup) { avisoDuplicado($('#e', ov), dup, ov); ov.scrollTop = 0; return false; }
    }
    const obsAlt = s(d.obs_alteracao).slice(0, 1000);
    const agora = agoraLocal();
    let idas = fech, hist = Array.isArray((chamado || a).historico) ? [...(chamado || a).historico] : [];
    if (chamado) {
      const enc = {}; CAMPOS_IDA.forEach(k => { enc[k] = chamado[k] ?? ''; });
      if (reag) enc.reagendamento = { motivo: d.reag_motivo, para: d.reag_para, em: agora, por: S.perfil.nome };
      else if (!agend) enc.devolucao = { setor: d.dev_setor, motivo: d.dev_motivo, em: normDataHora(d.dev_em) || agora, por: S.perfil.nome };
      idas = [...fech, enc];
      hist.push({ em: agora, por: S.perfil.nome, de: chamado.status || '', para: at.status, obs: [reag ? `${ordinal(ida)} — reagendado de ${fmtAgenda(chamado.agendamento)} para ${fmtAgenda(d.reag_para)} (${d.reag_motivo})` : agend ? `${ordinal(ida)} — atendimento do agendamento de ${fmtAgenda(chamado.agendamento)}` : `${ordinal(ida)} — devolvido por ${d.dev_setor} (${d.dev_motivo})`, obsAlt].filter(Boolean).join('. ') });
    } else if (novo) hist.push({ em: agora, por: S.perfil.nome, de: '', para: at.status, obs: obsAlt });
    else if (at.status !== (a.status || '') || obsAlt) hist.push({ em: agora, por: S.perfil.nome, de: a.status || '', para: at.status, obs: obsAlt });
    at.historico = hist.slice(-300);
    if (idas.length) at.idas = idas;
    at.meses = mesesDe(idas, at); at.uids = uidsDe(idas, at);
    try {
      await api.salvarAtendimento(novo ? null : (chamado || a).id, at);
      
      // Acionar verificação da fila rotativa Home Office se o atendimento foi fechado agora
      verificarPopupFilaHomeOffice(a, at);

      toast(reag ? `Reagendado para ${fmtAgenda(d.reag_para)} (${ordinal(ida)}).` : agend ? `Agendamento atendido (${ordinal(ida)}) no chamado ${at.smax}.` : chamado ? `${ordinal(ida)} registrada no chamado ${at.smax}.` : novo ? 'Atendimento registrado.' : 'Atendimento atualizado.');
      if (at.mes !== S.mes && novo) toast(`Registrado em ${nomeMes(at.mes)} (data do início).`);
      S.comarcas = [at.comarca, ...(S.comarcas || [])];
      refresh(); return true;
    } catch (e) { erroBox($('#e', ov), e.message); ov.scrollTop = 0; return false; }
  };
  const botoes = [];
  const dono = admin || a.uid === S.perfil.id;
  if (!novo && !chamado && dono && (admin || !fech.length)) botoes.push({ t: 'Excluir', danger: true, fn: async () => {
    if (!confirm(`${fech.length ? `Excluir o chamado inteiro (${fech.length + 1} idas)?` : 'Excluir este atendimento?'}\n\nEle vai para a Lixeira, e o líder pode restaurar em até ${DIAS_LIXEIRA} dias.`)) return false;
    try { await api.moverParaLixeira([a.id], S.perfil.nome, agoraLocal()); esquecerNoCache(a.id); toast('Atendimento movido para a Lixeira.'); refresh(); return true; } catch (e) { toast(e.message, true); return false; }
  } });
  if (!novo && !chamado && a.smax && PODE_REABRIR.includes(a.status || '')) botoes.push({ t: '↺ Chamado voltou: nova ida', fn: async () => {
    let ult = a;
    try { ult = (await smaxDuplicado(a.smax, null)) || a; } catch (e) { toast(e.message, true); return false; }
    if (!PODE_REABRIR.includes(ult.status || '')) { toast(`Este chamado já tem uma ida mais nova (${ult.status}). Abra a mais recente.`, true); return false; }
    setTimeout(() => formAtendimento(ult, { novaIda: true }), 0); return true;
  } });
  if (!novo && !chamado && a.status === 'AGENDADO') botoes.push(
    { t: '↻ Reagendar', fn: async () => { setTimeout(() => formAtendimento(a, { novaIda: true, reagendar: true }), 0); return true; } },
    { t: '▶ Atender agendamento', fn: async () => { setTimeout(() => formAtendimento(a, { novaIda: true, agendado: true }), 0); return true; } });
  if (podeEditar) botoes.push({ t: 'Cancelar' }, { t: novo ? 'Registrar' : chamado ? `Registrar ${ordinal(ida)}` : 'Salvar', primary: true, fn: salvar });
  else botoes.push({ t: 'Fechar', primary: true });
  modal(reag ? `Chamado ${esc(chamado.smax)} · reagendar` : agend ? `Chamado ${esc(chamado.smax)} · atender agendamento` : chamado ? `Chamado ${esc(chamado.smax)} · nova ida` : novo ? 'Novo atendimento' : `Chamado ${esc(a.smax || '')}${fech.length ? ` <span class="idas">↺ ${fech.length + 1} idas</span>` : ''}`, body, botoes, chamado || fech.length ? 'lg' : '', ov => {
    const f = $('#fa', ov);
    if (podeEditar) f.comarca.addEventListener('change', () => {
      const v = f.comarca.value; if (!v.trim()) return;
      const ofi = comarcaOficial(v);
      if (ofi) { f.comarca.value = ofi; erroBox($('#e', ov), ''); }
      else if (listaComarcas().length) avisoComarca($('#e', ov), v, ov);
      else f.comarca.value = tituloComarca(v);
    });
    if (podeEditar && !chamado && !fech.length) f.smax.addEventListener('change', async () => {
      const v = s(f.smax.value); if (!v || (!novo && v === a.smax)) return erroBox($('#e', ov), '');
      const dup = await smaxDuplicado(v, a.id).catch(() => null);
      if (dup) avisoDuplicado($('#e', ov), dup, ov); else erroBox($('#e', ov), '');
    });
    if (podeEditar) f.encaminhado_para.addEventListener('change', () => {
      const sg = $('.seg[data-name=status]', f);
      if (f.encaminhado_para.value && !$('button.on', sg)) $('button[data-v="ENCAMINHADO"]', sg).classList.add('on');
    });
    const atualizaDur = () => { const d = duracao(f.inicio.value, f.termino.value); $('#dur', ov).textContent = d ? `Tempo ${chamado || fech.length ? 'desta ida' : 'de atendimento'}: ${d}` : ''; };
    $$('[data-agora]', f).forEach(b => b.onclick = () => { f[b.dataset.agora].value = agoraLocal(); atualizaDur(); });
    f.inicio.oninput = f.termino.oninput = atualizaDur; atualizaDur();
    $$('.seg', f).forEach(sg => $$('button', sg).forEach(b => b.onclick = () => {
      const was = b.classList.contains('on');
      $$('button', sg).forEach(x => x.classList.remove('on'));
      if (!was) b.classList.add('on');
      if (sg.dataset.name === 'status') {
        const v = $('button.on', sg)?.dataset.v;
        $('#agBox', ov).hidden = v !== 'AGENDADO';
        if (v === 'AGENDADO') f.ag_data.focus();
        if (v === 'FECHADO' && !f.termino.value) { f.termino.value = agoraLocal(); atualizaDur(); }
      }
    }));
    const ligaDia = () => { const on = f.dia_inteiro.checked || f.juri.checked; if (f.juri.checked) f.dia_inteiro.checked = true;
      if (on) { f.ag_ini.value = DIA_INTEIRO[0]; f.ag_fim.value = DIA_INTEIRO[1]; } if (podeEditar) { f.ag_ini.disabled = f.ag_fim.disabled = on; } };
    f.dia_inteiro.onchange = () => { if (!f.dia_inteiro.checked) f.juri.checked = false; ligaDia(); }; f.juri.onchange = ligaDia; if (f.dia_inteiro.checked || f.juri.checked) ligaDia();
    if (reag) { $('#agBox', ov).hidden = true; $$('.seg[data-name=status] button', f).forEach(b => b.disabled = true); f.reag_para.focus(); }
    else if (chamado && !agend) f.dev_motivo.focus();
  });
}
function avisoComarca(el, v, ov) {
  const parecidas = listaComarcas().filter(c => chaveComarca(c).includes(chaveComarca(v).slice(0, 4))).slice(0, 5);
  el.innerHTML = `<div class="err">A comarca <b>"${esc(v)}"</b> não está na lista de comarcas. Escolha uma das sugestões do campo${parecidas.length ? `, por exemplo: ${parecidas.map(c => `<a href="#" class="sug-com">${esc(c)}</a>`).join(', ')}` : ''}.
    <div style="margin-top:8px"><button type="button" class="btn sm" id="addCom">É uma comarca nova: cadastrar "${esc(tituloComarca(v))}"</button></div></div>`;
  $$('.sug-com', el).forEach(a => a.onclick = e => { e.preventDefault(); $('#fa', ov).comarca.value = a.textContent; erroBox(el, ''); });
  const add = $('#addCom', el);
  if (add) add.onclick = async () => {
    const resp = prompt('Nome oficial da comarca (confira os acentos, ex.: Mairiporã):', tituloComarca(v));
    if (!resp || !resp.trim()) return;
    const nova = tituloComarca(resp);
    const ja = comarcaOficial(nova);
    if (ja) { $('#fa', ov).comarca.value = ja; erroBox(el, ''); toast(`"${ja}" já estava na lista.`); return; }
    const pare = comarcasParecidas(nova);
    if (pare.length && !confirm(`Já existem comarcas parecidas na lista:\n\n${pare.join(', ')}\n\nTem certeza de que "${nova}" é uma comarca diferente?`)) return;
    try { await cadastrarComarca(nova); $('#fa', ov).comarca.value = nova; erroBox(el, ''); toast(`"${nova}" cadastrada na lista.`); }
    catch (e) { toast(e.message, true); }
  };
}
function comarcasParecidas(v) {
  const k = chaveComarca(v);
  const dist = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length]; };
  return listaComarcas().filter(c => { const kc = chaveComarca(c); return kc.slice(0, 5) === k.slice(0, 5) || dist(kc, k) <= 2; }).slice(0, 6);
}
async function cadastrarComarca(nome) {
  await api.adicionarComarca(nome, S.perfil.nome);
  S.comarcasOficiais = await api.lerComarcas();
  const dl = $('#dlComarcas'); if (dl) dl.innerHTML = listaComarcas().map(c => `<option value="${esc(c)}">`).join('');
}
async function salvarListaComarcas(l) {
  const mapa = new Map(); l.forEach(c => { const n = tituloComarca(c), k = chaveComarca(n); if (k && !mapa.has(k)) mapa.set(k, c.trim() && c === n ? c : n); });
  const final = [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  await api.salvarComarcas(final, S.perfil.nome);
  S.comarcasOficiais = final;
  const dl = $('#dlComarcas'); if (dl) dl.innerHTML = final.map(c => `<option value="${esc(c)}">`).join('');
  return final;
}

async function smaxDuplicado(smax, idAtual) {
  const l = (await api.buscarPorSmax(smax)).filter(x => x.id !== idAtual && foraDaLixeira(x));
  l.sort((x, y) => ((y.ida || 1) - (x.ida || 1)) || (y.inicio || y.data_ref || '').localeCompare(x.inicio || x.data_ref || ''));
  return l[0] || null;
}
function avisoDuplicado(el, dup, ov) {
  const reabre = PODE_REABRIR.includes(dup.status || '');
  const n = numIdas(dup) + (dup.ida > 1 ? dup.ida - 1 : 0);
  el.innerHTML = `<div class="err">O chamado SMAX <b>${esc(dup.smax)}</b> já existe: ida atual de <b>${esc(nomeDe(dup.uid, dup.tecnico))}</b>
    em ${fmtData(dup.data_ref)} (${esc(dup.status || 'sem status')}${dup.encaminhado_para ? ' para ' + esc(dup.encaminhado_para) : ''}${n > 1 ? ', ' + ordinal(n) : ''}).
    ${dup.status === 'AGENDADO' ? `Está agendado para <b>${fmtAgenda(dup.agendamento)}</b>: use <b>Atender agendamento</b> para registrar o atendimento no mesmo chamado.` : reabre ? 'Se o setor devolveu o chamado, registre uma <b>nova ida</b> nele: continua sendo o mesmo chamado e a nova ida conta como mais um atendimento.' : 'Atualize o registro existente em vez de criar outro.'}
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${reabre ? '<button type="button" class="btn sm primary" id="reabrirDup">↺ Ele voltou: nova ida</button>' : ''}${dup.status === 'AGENDADO' ? '<button type="button" class="btn sm primary" id="atenderDup">▶ Atender agendamento</button><button type="button" class="btn sm" id="reagDup">↻ Reagendar</button>' : ''}<button type="button" class="btn sm" id="abrirDup">Abrir o chamado</button></div></div>`;
  $('#abrirDup', el).onclick = () => { ov.remove(); formAtendimento(dup); };
  if (reabre) $('#reabrirDup', el).onclick = () => { ov.remove(); formAtendimento(dup, { novaIda: true }); };
  if ($('#atenderDup', el)) $('#atenderDup', el).onclick = () => { ov.remove(); formAtendimento(dup, { novaIda: true, agendado: true }); };
  if ($('#reagDup', el)) $('#reagDup', el).onclick = () => { ov.remove(); formAtendimento(dup, { novaIda: true, reagendar: true }); };
}
function linhaDoTempo(h) {
  if (!Array.isArray(h) || !h.length) return '<p class="hint" style="margin:4px 0 8px">Ainda sem histórico. As próximas mudanças de status e observações vão aparecer aqui.</p>';
  return `<ol class="timeline">${[...h].reverse().map(e => `<li>
    <div class="tl-quando">${fmtData(e.em)} ${esc((e.em || '').slice(11, 16))} · <b>${esc(e.por || '')}</b></div>
    <div class="tl-o-que">${!e.de && e.para ? `Registrado como ${chip(e.para)}` : e.de !== e.para ? `${chip(e.de)} <span class="seta">→</span> ${chip(e.para)}` : 'Observação'}</div>
    ${e.obs ? `<div class="tl-obs">${esc(e.obs)}</div>` : ''}</li>`).join('')}</ol>`;
}
function refresh() { if (S.recarregar && rota() === 'atendimentos') S.recarregar(); else render(); }

// --------------------------------------------------------------- Agenda
async function telaAgenda(main) {
  S.recarregar = null;
  main.innerHTML = `<div class="head"><div><h2>Agenda</h2><p>Atendimentos com status AGENDADO, em ordem de horário.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${botaoAtu()}<button class="btn primary" id="novo">+ Novo atendimento</button></div></div><div id="lista"><div class="empty">Carregando…</div></div>`;
  $('#novo').onclick = () => formAtendimento(null);
  let lista; try { 
    lista = (await api.listarAgendados({ uid: isAdmin() ? null : S.perfil.id })).filter(foraDaLixeira); 
    lista = filtrarChamadosPorPerfil(lista);
    S.assin_agenda = assinatura(lista); 
  } catch (e) { return toast(e.message, true); }
  lista.sort((a, b) => (a.agendamento || '9999').localeCompare(b.agendamento || '9999'));
  if (!lista.length) { $('#lista').innerHTML = `<div class="card"><div class="empty">Nenhum atendimento agendado no momento.</div></div>`; return; }
  const agora = agoraLocal();
  $('#lista').innerHTML = `<div class="agenda">${lista.map(a => {
    const fim = fimAgenda(a), late = !!a.agendamento && fim < agora, andamento = !!a.agendamento && a.agendamento <= agora && agora <= fim;
    const d = (a.agendamento || '').slice(0, 10), t = a.agendamento ? `${a.agendamento.slice(11, 16)}–${fim.slice(11, 16)}` : '';
    const nReag = idasFechadas(a).filter(x => x.reagendamento).length;
    return `<div class="ag-item ${late ? 'late' : andamento ? 'andamento' : ''}" data-id="${esc(a.id)}">
      <div class="when"><b>${t || '--:--'}</b><small>${d ? fmtData(d) : 'sem horário'}${a.dia_inteiro ? ' · dia inteiro' : ''}${late ? ' · atrasado' : ''}</small></div>
      <div class="what"><b>SMAX ${esc(a.smax)} · ${esc(a.comarca)}${a.juri ? ' <span class="tag-juri">⚖️ Júri</span>' : ''}${andamento ? ' <span class="tag-andamento">🟢 em andamento</span>' : ''}${nReag ? ` <span class="tag-reag" title="Quantas vezes já foi reagendado">↻ reagendado ${nReag}×</span>` : ''}</b><small>${esc(a.usuario_atendido || 'usuário não informado')}${a.obs ? ' — ' + esc(a.obs) : ''}${isAdmin() ? ' · ' + esc(nomeDe(a.uid, a.tecnico)) : ''}</small></div>
      <div class="ag-acoes"><button type="button" class="btn sm" data-reag="${esc(a.id)}" title="O usuário não pôde: marcar nova data">↻ Reagendar</button><button type="button" class="btn sm primary" data-atender="${esc(a.id)}" title="Registrar o atendimento">▶ Atender</button></div></div>`;
  }).join('')}</div>`;
  const doc = id => lista.find(a => a.id === id);
  $$('.ag-item').forEach(el => el.onclick = () => formAtendimento(doc(el.dataset.id)));
  $$('.ag-item [data-reag]').forEach(b => b.onclick = e => { e.stopPropagation(); formAtendimento(doc(b.dataset.reag), { novaIda: true, reagendar: true }); });
  $$('.ag-item [data-atender]').forEach(b => b.onclick = e => { e.stopPropagation(); formAtendimento(doc(b.dataset.atender), { novaIda: true, agendado: true }); });
}

// --------------------------------------------------------------- Painel
function diasUteis(mes) {
  const [y, m] = mes.split('-').map(Number);
  const h = new Date(); let ate = new Date(y, m, 0).getDate();
  if (h.getFullYear() === y && h.getMonth() + 1 === m) ate = h.getDate();
  else if (new Date(y, m - 1, 1) > h) return 0;
  let n = 0; for (let d = 1; d <= ate; d++) { const w = new Date(y, m - 1, d).getDay(); if (w && w < 6) n++; }
  return n;
}
function minutosDe(a) {
  if (!a.inicio || !a.termino) return null;
  const m = Math.round((new Date(a.termino) - new Date(a.inicio)) / 60000);
  return isNaN(m) || m < 0 ? null : m;
}
function tempos(r, lista) {
  const ms = lista.map(minutosDe).filter(m => m !== null);
  r.min_total = ms.reduce((t, m) => t + m, 0);
  r.com_tempo = ms.length;
  r.min_medio = ms.length ? Math.round(r.min_total / ms.length) : null;
}
function temposTent(r, lista) {
  const ms = lista.filter(a => !contaComoAtendido(a)).map(minutosDe).filter(m => m !== null);
  r.tent_min_total = ms.reduce((t, m) => t + m, 0);
  r.tent_com_tempo = ms.length;
  r.tent_min_medio = ms.length ? Math.round(r.tent_min_total / ms.length) : null;
}
const fmtMinCurto = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}`;
const fmtMin = m => m === null || m === undefined ? '—' : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
const contaComoAtendido = a => a.status !== 'TENT CONTATO';

function montarPainel(mes, lista) {
  const ids = new Set(S.usuarios.filter(u => u.ativo).map(u => u.id));
  lista.forEach(a => ids.add(a.uid));
  const linhas = [...ids].map(uid => {
    const m = lista.filter(a => a.uid === uid); const c = k => m.filter(a => a.status === k).length;
    const r = { uid, nome: nomeDe(uid, (m[0] || {}).tecnico), encaminhado: c('ENCAMINHADO'), tent_contato: c('TENT CONTATO'), agendado: c('AGENDADO'), fechado: c('FECHADO'), devolvido: c('DEVOLVIDO'),
      reabertos: m.filter(a => a._reaberto && contaComoAtendido(a)).length, chamados: new Set(m.filter(contaComoAtendido).map(a => a.smax || a.id)).size,
      home: m.filter(a => a.home_local === 'HOME').length, local: m.filter(a => a.home_local === 'LOCAL').length };
    r.total = r.encaminhado + r.agendado + r.fechado + r.devolvido;
    tempos(r, m.filter(contaComoAtendido)); temposTent(r, m); return r;
  }).sort((a, b) => a.nome.localeCompare(b.nome));
  const total = { nome: 'TOTAL' };
  for (const k of ['encaminhado', 'tent_contato', 'agendado', 'fechado', 'devolvido', 'reabertos', 'home', 'local', 'total']) total[k] = linhas.reduce((t, r) => t + r[k], 0);
  const atendidos = lista.filter(contaComoAtendido);
  total.chamados = new Set(atendidos.map(a => a.smax || a.id)).size;
  const dv = {}; lista.filter(a => a.status === 'DEVOLVIDO').forEach(a => { const st = (a.devolucao && a.devolucao.setor) || a.encaminhado_para || 'Sem setor'; const g = dv[st] = dv[st] || { setor: st, n: 0, motivos: {}, par: [], itens: [] }; g.n++; g.itens.push(a); const pm = parado(a); if (pm !== null) g.par.push(pm); const mo = (a.devolucao && a.devolucao.motivo) || 'Sem motivo'; g.motivos[mo] = (g.motivos[mo] || 0) + 1; });
  const enviados = {}; atendidos.forEach(a => { if (a.encaminhado_para) enviados[a.encaminhado_para] = (enviados[a.encaminhado_para] || 0) + 1; });
  const devolucoes = Object.values(dv).map(g => ({ ...g, enviados: enviados[g.setor] || g.n, parMedio: g.par.length ? Math.round(g.par.reduce((t, x) => t + x, 0) / g.par.length) : null })).sort((a, b) => b.n - a.n);
  tempos(total, atendidos); temposTent(total, lista);
  const destinos = ENCAMINHADO_PARA.map(d => ({ destino: d, n: atendidos.filter(a => a.encaminhado_para === d).length }));
  const cont = {}; atendidos.forEach(a => { if (a.comarca) { const c = nomeComarca(a.comarca); cont[c] = (cont[c] || 0) + 1; } });
  const porComarca = Object.entries(cont).map(([comarca, n]) => ({ comarca, n })).sort((a, b) => b.n - a.n).slice(0, 10);
  const du = diasUteis(mes);
  return { mes, linhas, total, destinos, porComarca, devolucoes, diasUteis: du, mediaDiaria: du ? +(total.total / du).toFixed(1) : 0 };
}
async function telaPainel(main) {
  S.recarregar = null;
  main.innerHTML = `<div class="head"><div><h2>Painel — Atendimento Técnico Field</h2><p>${esc(nomeMes(S.mes))}</p></div>
    <div class="toolbar" style="margin:0">${botaoAtu()}<input type="month" id="fMes" value="${S.mes}"><button class="btn" id="exp">Exportar Excel</button></div></div>
    <div id="pn"><div class="empty">Carregando…</div></div>`;
  $('#fMes').onchange = e => { if (e.target.value) { S.mes = e.target.value; S.painelDia = ''; render(); } };
  $('#exp').onclick = exportarExcel;
  let lista; try { 
    let docs = await docsDoMes(S.mes); 
    // Aplicar estritamente o filtro de perfil: técnicos comuns veem apenas os seus próprios dados no painel
    docs = filtrarChamadosPorPerfil(docs);
    S.assin_painel = assinatura(docs); 
    lista = explodir(docs, S.mes); 
  } catch (e) { return toast(e.message, true); }
  S.comarcas = [...new Set([...lista.map(a => a.comarca), ...(S.comarcas || [])])];
  const mesGeral = montarPainel(S.mes, lista);
  if (S.painelTec && !mesGeral.linhas.some(r => r.uid === S.painelTec)) S.painelTec = '';
  if (S.painelDia && S.painelDia.slice(0, 7) !== S.mes) S.painelDia = '';
  const semana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  const desenhar = () => {
    const admin = isAdmin();
    const uid = admin ? (S.painelTec || '') : S.perfil.id;
    const dia = S.painelDia || '';
    const doMesTec = uid ? lista.filter(a => a.uid === uid) : lista;
    const base = dia ? lista.filter(a => a.data_ref === dia) : lista;
    const geral = dia ? montarPainel(S.mes, base) : mesGeral;
    const sel = geral.linhas.find(r => r.uid === uid) || mesGeral.linhas.find(r => r.uid === uid);
    const doSel = uid ? base.filter(a => a.uid === uid) : base;
    const p = uid ? montarPainel(S.mes, doSel) : geral;
    const T = uid ? (geral.linhas.find(r => r.uid === uid) || sel) : geral.total;
    const media = p.diasUteis ? +(T.total / p.diasUteis).toFixed(1) : 0;
    const [yy, mm] = S.mes.split('-').map(Number), nDias = new Date(yy, mm, 0).getDate();
    const contDia = {}; doMesTec.forEach(a => { contDia[a.data_ref] = (contDia[a.data_ref] || 0) + 1; });
    let opcDias = '<option value="">Todos os dias</option>';
    for (let d = 1; d <= nDias; d++) {
      const iso = `${S.mes}-${String(d).padStart(2, '0')}`, q = contDia[iso] || 0;
      opcDias += `<option value="${iso}" ${dia === iso ? 'selected' : ''}>${String(d).padStart(2, '0')}/${S.mes.slice(5, 7)} (${semana[new Date(yy, mm - 1, d).getDay()]}${q ? ` — ${q}` : ''})</option>`;
    }
    const filtros = [admin && uid ? `<b>${esc(sel?.nome || '')}</b>` : '', dia ? `<b>${fmtData(dia)}</b>` : ''].filter(Boolean).join(' · ');
    const linha = (r, tot) => `<tr class="${tot ? 'total' : ''} click ${!tot && r.uid === uid ? 'sel' : ''} ${admin && uid && !tot && r.uid !== uid ? 'apagado' : ''}" data-uid="${tot ? '' : esc(r.uid)}" title="${tot ? 'Ver todos os técnicos' : 'Ver só ' + esc(r.nome)}">
      <td>${esc(r.nome)}${tot ? '' : marcaDesligado(r.uid)}</td><td class="num">${r.encaminhado}</td><td class="num">${r.tent_contato}</td><td class="num">${r.agendado}</td><td class="num">${r.fechado}</td><td class="num">${r.devolvido || ''}</td><td class="num">${r.home}</td><td class="num">${r.local}</td><td class="num"><b>${r.total}</b></td><td class="num">${r.chamados}${r.reabertos ? ` <span class="muted" title="chamados reabertos">(${r.reabertos}↺)</span>` : ''}</td><td class="num">${r.com_tempo ? fmtMin(r.min_total) : '—'}</td><td class="num tempo" title="${r.com_tempo} atendimento(s) com início e término">${fmtMin(r.min_medio)}</td><td class="num col-tent">${r.tent_com_tempo ? fmtMin(r.tent_min_total) : '—'}</td><td class="num col-tent tempo-tent" title="${r.tent_com_tempo} tentativa(s) com início e término">${fmtMin(r.tent_min_medio)}</td></tr>`;
    const maxD = Math.max(1, ...p.destinos.map(d => d.n)), maxC = Math.max(1, ...p.porComarca.map(d => d.n));
    $('#pn').innerHTML = `
      <div class="filtro-tec">
        ${admin ? `<label>Técnico:
          <select id="pTec"><option value="">Todos os técnicos</option>${mesGeral.linhas.map(r => `<option value="${esc(r.uid)}" ${r.uid === uid ? 'selected' : ''}>${esc(r.nome)}${desligado(r.uid) ? ' (desligado)' : ''}</option>`).join('')}</select></label>` : ''}
        <label>Dia:
          <select id="pDia">${opcDias}</select></label>
        ${S.mes === mesAtual() ? '<button type="button" class="btn" id="pHoje">Hoje</button>' : ''}
        ${filtros ? `<span class="filtro-info">Mostrando apenas ${filtros} · <a href="#" id="limparFiltros">limpar filtros</a>${dia ? ` · <a href="#" id="listaDia">ver atendimentos do dia</a>` : ''}</span>` : admin ? '<span class="filtro-info">Clique em um técnico na tabela ou em um dia do calendário para filtrar.</span>' : ''}
      </div>
      <div class="kpis">
        <div class="kpi enc"><span>Encaminhado</span><b>${T.encaminhado}</b></div>
        <div class="kpi tent" title="Tentativas de contato não contam como chamado atendido"><span>Tent. contato</span><b>${T.tent_contato}</b><small class="fora">fora do total</small></div>
        <div class="kpi ag"><span>Agendado</span><b>${T.agendado}</b></div>
        <div class="kpi fech"><span>Fechado</span><b>${T.fechado}</b></div>
        <div class="kpi tot"><span>Total geral</span><b>${T.total}</b>${T.reabertos ? `<small class="fora">${T.chamados} chamado(s) · ${T.reabertos} reaberto(s)</small>` : ''}</div>
        ${T.devolvido ? `<div class="kpi dev" title="Idas que o setor devolveu; cada ida conta como atendimento"><span>Devolvido</span><b>${T.devolvido}</b></div>` : ''}
        ${dia ? `<div class="kpi" title="Tempo de atendimento no dia selecionado"><span>Média diária</span><b>${fmtMinCurto(T.min_total || 0)}</b><small class="fora">${fmtData(dia).slice(0, 5)} · ${T.total} atendimento(s)</small></div>`
              : `<div class="kpi" title="Minutos de atendimento ÷ ${p.diasUteis} dias úteis (seg. a sex.)"><span>Média diária</span><b>${p.diasUteis ? fmtMinCurto(Math.round((T.min_total || 0) / p.diasUteis)) : '—'}</b><small class="fora">${String(media).replace('.', ',')} atendimento(s) por dia</small></div>`}
        <div class="kpi"><span>Tempo médio</span><b>${fmtMin(T.min_medio)}</b></div>
        <div class="kpi tent" title="Tempo médio de cada tentativa de contato (início até término)"><span>Média por tentativa</span><b>${fmtMin(T.tent_min_medio)}</b><small class="fora">${T.tent_com_tempo ? fmtMin(T.tent_min_total) + ' em tentativas' : 'sem tentativas com horário'}</small></div>
      </div>
      <div class="card"><h3>Por técnico${dia ? ` <span class="muted">· ${fmtData(dia)}</span>` : ''}</h3><div class="tablewrap"><table class="tab-tec">
          <thead><tr><th>Técnico</th><th class="num">Encaminhado</th><th class="num" title="Não conta no total">Tent. contato*</th><th class="num">Agendado</th><th class="num">Fechado</th><th class="num" title="Idas que o setor devolveu (contam no total)">Devolvido</th><th class="num">Remoto/Home</th><th class="num">Local</th><th class="num">Total geral</th><th class="num" title="Chamados SMAX diferentes. Entre parênteses: idas de chamados reabertos">Chamados</th><th class="num">Horas totais</th><th class="num">Tempo médio</th><th class="num col-tent">Horas em tent.</th><th class="num col-tent">Média por tent.</th></tr></thead>
          <tbody>${(admin && uid ? geral.linhas.filter(r => r.uid === uid) : geral.linhas).map(r => linha(r)).join('')}${admin && !uid ? linha(geral.total, true) : ''}</tbody></table></div>
          ${admin && uid ? `<div class="pad hint" style="padding-bottom:0">Mostrando só ${esc(sel?.nome || '')}. <a href="#" id="verTodos2">Ver todos os técnicos</a></div>` : ''}
          <div class="pad hint"><b>Chamado devolvido e reaberto</b>: cada ida conta como um atendimento, no dia e para o técnico que atendeu. A coluna <b>Chamados</b> mostra quantos SMAX diferentes foram atendidos (↺ = idas de chamados reabertos).<br><b>Tentativa de contato não conta como chamado atendido</b>: aparece na coluna própria, mas fica fora do total geral, das horas, do tempo médio, dos gráficos e do calendário.<br>${dia ? 'Números do dia ' + fmtData(dia) + '.' : `Média diária = minutos de atendimento ÷ ${p.diasUteis} dias úteis (seg. a sex.) ${p.mes === mesAtual() ? 'até hoje' : 'do mês'}; embaixo, a quantidade de atendimentos por dia.`}
            Tempo médio = horas de atendimento ÷ atendimentos com início e término preenchidos.</div></div>
      <div class="graficos">
          <div class="card"><h3>Atendimento SAJ — encaminhados para${filtros ? ` <span class="muted">· ${filtros.replace(/<\/?b>/g, '')}</span>` : ''}</h3><div class="pad bars">${p.destinos.map(d => `<div class="bar"><span>${esc(d.destino)}</span><div class="t"><i style="width:${d.n / maxD * 100}%"></i></div><b>${d.n}</b></div>`).join('')}</div></div>
          ${p.devolucoes.length ? `<div class="card"><h3>Devoluções por setor${filtros ? ` <span class="muted">· ${filtros.replace(/<\/?b>/g, '')}</span>` : ''}</h3><div class="pad">
            <table class="tab-dev"><thead><tr><th>Setor</th><th class="num">Devolvidos</th><th class="num" title="Devolvidos ÷ encaminhados para o setor no período">Taxa</th><th class="num" title="Do encaminhamento até a devolução">Tempo médio parado</th><th></th></tr></thead><tbody>
            ${p.devolucoes.map((g, gi) => { const aberto = S.devAberto === g.setor; return `<tr class="dev-set" data-setor="${esc(g.setor)}"><td><span class="tag">${esc(g.setor)}</span></td><td class="num"><b>${g.n}</b></td><td class="num">${Math.round(g.n / Math.max(g.n, g.enviados) * 100)}%</td><td class="num">${fmtMin(g.parMedio)}</td><td class="num dev-seta">${aberto ? '▾ fechar' : '▸ ver motivos'}</td></tr>
              ${aberto ? `<tr class="dev-det"><td colspan="5"><ul>${[...g.itens].sort((x, y) => ((y.devolucao || {}).em || '').localeCompare((x.devolucao || {}).em || '')).map((a, ii) => { const pm = parado(a), d = a.devolucao || {};
                return `<li data-g="${gi}" data-i="${ii}"><b class="mono">SMAX ${esc(a.smax)}</b> · ${esc(nomeComarca(a.comarca))} · ${fmtData(d.em || a.data_ref).slice(0, 5)}${pm !== null ? ' · parado ' + fmtMin(pm) : ''}<br>${esc(d.motivo || 'Sem motivo')}</li>`; }).join('')}</ul></td></tr>` : ''}`; }).join('')}
            </tbody></table><div class="hint" style="margin-top:8px">Clique no setor para ver os motivos e os chamados. Taxa = devolvidos ÷ chamados encaminhados para o setor no período. Tempo parado = do fim da ida até a devolução (não entra nas horas dos técnicos).</div></div></div>` : ''}
          <div class="card"><h3>Comarcas com mais atendimentos${filtros ? ` <span class="muted">· ${filtros.replace(/<\/?b>/g, '')}</span>` : ''}</h3><div class="pad bars">${p.porComarca.length ? p.porComarca.map(d => `<div class="bar"><span title="${esc(d.comarca)}">${esc(d.comarca)}</span><div class="t"><i style="width:${d.n / maxC * 100}%"></i></div><b>${d.n}</b></div>`).join('') : `<div class="muted">Sem dados ${dia ? 'no dia' : 'no mês'}.</div>`}</div></div>
      </div>
      <div class="card cal-card">
        <div class="cal-head"><h3>Calendário de ${esc(nomeMes(S.mes))}${admin && uid ? ` <span class="muted">· ${esc(sel?.nome || '')}</span>` : ' <span class="muted">· todos os técnicos</span>'}</h3>
          ${admin ? `<select id="calTec" aria-label="Técnico"><option value="">Todos os técnicos</option>${mesGeral.linhas.map(r => `<option value="${esc(r.uid)}" ${r.uid === uid ? 'selected' : ''}>${esc(r.nome)}${desligado(r.uid) ? ' (desligado)' : ''}</option>`).join('')}</select>` : ''}</div>
        <div class="pad" id="cal"></div>
      </div>
      <div class="card cal-card">
        <h3>Tentativas de contato por dia${admin && uid ? ` <span class="muted">· ${esc(sel?.nome || '')}</span>` : ' <span class="muted">· todos os técnicos</span>'}</h3>
        <div class="tablewrap" id="tentDia"></div>
      </div>`;
    calendario($('#cal'), doMesTec, '', { sel: dia, aoClicar: iso => escolherDia(iso === dia ? '' : iso) });
    tentativasPorDia($('#tentDia'), doMesTec, admin && !uid);
    const escolher = v => { S.painelTec = v; desenhar(); };
    const escolherDia = v => { S.painelDia = v; desenhar(); };
    $('#pDia').onchange = e => escolherDia(e.target.value);
    if ($('#pHoje')) $('#pHoje').onclick = () => escolherDia(hojeISO());
    if ($('#limparFiltros')) $('#limparFiltros').onclick = e => { e.preventDefault(); S.painelTec = ''; S.painelDia = ''; desenhar(); };
    if ($('#listaDia')) $('#listaDia').onclick = e => { e.preventDefault(); diaDetalhe(Number(dia.slice(8, 10)), doSel); };
    if ($('#pTec')) $('#pTec').onchange = e => escolher(e.target.value);
    if ($('#calTec')) $('#calTec').onchange = e => escolher(e.target.value);
    if ($('#verTodos2')) $('#verTodos2').onclick = e => { e.preventDefault(); escolher(''); };
    $$('#pn tr.dev-set').forEach(tr => tr.onclick = () => { S.devAberto = S.devAberto === tr.dataset.setor ? '' : tr.dataset.setor; desenhar(); });
    $$('#pn tr.dev-det li').forEach(li => li.onclick = () => {
      const g = p.devolucoes[li.dataset.g], l = [...g.itens].sort((x, y) => ((y.devolucao || {}).em || '').localeCompare((x.devolucao || {}).em || ''));
      const a = l[li.dataset.i]; if (a) formAtendimento(a._doc || a);
    });
    if (admin) {
      $$('#pn tbody tr[data-uid]').forEach(tr => tr.onclick = () => escolher(tr.dataset.uid === uid ? '' : tr.dataset.uid));
    }
  };
  desenhar();
}

function calendario(el, lista, uid, opts = {}) {
  const [y, m] = S.mes.split('-').map(Number);
  const dias = new Date(y, m, 0).getDate(), inicioSem = new Date(y, m - 1, 1).getDay();
  const doMes = uid ? lista.filter(a => a.uid === uid) : lista;
  const porDia = {}; doMes.forEach(a => { const d = Number((a.data_ref || '').slice(8, 10)); if (d) (porDia[d] = porDia[d] || []).push(a); });
  const max = Math.max(1, ...Object.values(porDia).map(l => l.filter(contaComoAtendido).length));
  const hoje = hojeISO();
  let html = '<div class="cal">' + ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<div class="cal-sem">${d}</div>`).join('');
  for (let i = 0; i < inicioSem; i++) html += '<div class="cal-dia vazio"></div>';
  for (let d = 1; d <= dias; d++) {
    const l = porDia[d] || [], n = l.filter(contaComoAtendido).length, tent = l.length - n, w = new Date(y, m - 1, d).getDay();
    const iso = `${S.mes}-${String(d).padStart(2, '0')}`;
    const fech = l.filter(a => a.status === 'FECHADO').length, min = l.filter(contaComoAtendido).map(minutosDe).filter(x => x !== null).reduce((t, x) => t + x, 0);
    const alpha = n ? 0.12 + 0.55 * (n / max) : 0;
    html += `<button type="button" class="cal-dia ${w === 0 || w === 6 ? 'fds' : ''} ${iso === hoje ? 'hoje' : ''} ${l.length ? 'tem' : ''} ${opts.sel === iso ? 'escolhido' : ''}" data-dia="${d}"
      style="${n ? `background:rgba(44,82,130,${alpha.toFixed(2)});${alpha > .45 ? 'color:#fff' : ''}` : ''}" ${l.length ? '' : 'disabled'}
      title="${l.length ? `${n} atendimento(s) · ${fech} fechado(s)${min ? ' · ' + fmtMin(min) : ''}${tent ? ` · ${tent} tentativa(s) de contato (fora do total)` : ''}` : 'Sem atendimentos'}">
      <span class="cal-n">${d}</span>${tent ? `<span class="cal-tent">+${tent} tent.</span>` : ''}${n ? `<b>${n}</b><small>${n === 1 ? 'atendimento' : 'atendimentos'}</small>` : ''}</button>`;
  }
  html += '</div><div class="hint" style="margin-top:10px">Clique em um dia para filtrar o painel por ele (clique de novo para voltar ao mês). Quanto mais escuro, mais atendimentos no dia. "+1 tent." = tentativas de contato, que não entram na contagem.</div>';
  el.innerHTML = html;
  $$('.cal-dia.tem', el).forEach(b => b.onclick = () => opts.aoClicar
    ? opts.aoClicar(`${S.mes}-${String(b.dataset.dia).padStart(2, '0')}`)
    : diaDetalhe(Number(b.dataset.dia), porDia[b.dataset.dia]));
}
function tentativasPorDia(el, lista, mostrarTec) {
  const tent = lista.filter(a => !contaComoAtendido(a));
  if (!tent.length) { el.innerHTML = '<div class="empty" style="padding:24px">Nenhuma tentativa de contato neste mês.</div>'; return; }
  const dias = {};
  tent.forEach(a => { const k = (a.data_ref || '').slice(0, 10); (dias[k] = dias[k] || []).push(a); });
  const semana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const linhas = Object.keys(dias).sort().map(k => {
    const l = dias[k], r = {}; temposTent(r, l);
    let tecs = '';
    if (mostrarTec) {
      const por = {}; l.forEach(a => { (por[a.uid] = por[a.uid] || []).push(a); });
      tecs = Object.entries(por).map(([u, la]) => { const t = {}; temposTent(t, la); return `${esc(nomeDe(u, la[0].tecnico))} <span class="muted">${la.length}${t.tent_com_tempo ? ' · ' + fmtMin(t.tent_min_medio) : ''}</span>`; }).join(' · ');
    }
    const [yy, mm, dd] = k.split('-');
    return `<tr class="click" data-dia="${Number(dd)}"><td><b>${dd}/${mm}</b> <span class="muted">${semana[new Date(+yy, mm - 1, +dd].getDay()]}</span></td>
      <td class="num">${l.length}</td><td class="num">${r.tent_com_tempo ? fmtMin(r.tent_min_total) : '—'}</td><td class="num tempo-tent">${fmtMin(r.tent_min_medio)}</td>${mostrarTec ? `<td class="wrap">${tecs}</td>` : ''}</tr>`;
  });
  const T = {}; temposTent(T, tent);
  el.innerHTML = `<table><thead><tr><th>Dia</th><th class="num">Tentativas</th><th class="num">Horas</th><th class="num">Média por tentativa</th>${mostrarTec ? '<th>Por técnico (qtd · média)</th>' : ''}</tr></thead>
    <tbody>${linhas.join('')}<tr class="total"><td>Mês</td><td class="num">${tent.length}</td><td class="num">${T.tent_com_tempo ? fmtMin(T.tent_min_total) : '—'}</td><td class="num">${fmtMin(T.tent_min_medio)}</td>${mostrarTec ? '<td></td>' : ''}</tr></tbody></table>
    <div class="pad hint">Tempo de cada tentativa = do início ao término informados no registro. Clique em um dia para ver os registros.</div>`;
  $$('tr[data-dia]', el).forEach(tr => tr.onclick = () => {
    const d = Number(tr.dataset.dia);
    diaDetalhe(d, lista.filter(a => Number((a.data_ref || '').slice(8, 10)) === d));
  });
}

function diaDetalhe(d, l) {
  l = [...l].sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
  const data = `${String(d).padStart(2, '0')}/${S.mes.slice(5, 7)}/${S.mes.slice(0, 4)}`;
  const min = l.filter(contaComoAtendido).map(minutosDe).filter(x => x !== null);
  const nTent = l.filter(a => !contaComoAtendido(a)).length;
  const tt = {}; temposTent(tt, l);
  const { fechar } = modal(`Atendimentos de ${data}`, `
    <p class="hint" style="margin-top:0">${l.length - nTent} atendimento(s)${nTent ? ` + ${nTent} tentativa(s) de contato (fora do total${tt.tent_com_tempo ? `: ${fmtMin(tt.tent_min_total)}, média ${fmtMin(tt.tent_min_medio)}` : ''})` : ''}${min.length ? ` · ${fmtMin(min.reduce((t, x) => t + x, 0))} de atendimento · média ${fmtMin(Math.round(min.reduce((t, x) => t + x, 0) / min.length))}` : ''}</p>
    <div class="tablewrap"><table><thead><tr><th>Início</th><th>SMAX</th><th>Comarca</th><th>Técnico</th><th class="num">Tempo</th><th>Status</th></tr></thead><tbody>
    ${l.map((a, i) => `<tr class="click" data-i="${i}"><td>${esc((a.inicio || '').slice(11, 16))}</td><td class="mono"><b>${esc(a.smax)}</b>${(a._ida || 1) > 1 ? ` <span class="tag-ida">${ordinal(a._ida)}</span>` : ''}</td><td>${esc(a.comarca)}</td><td>${esc(nomeDe(a.uid, a.tecnico))}</td><td class="num">${duracao(a.inicio, a.termino)}</td><td>${chip(a.status)}</td></tr>`).join('')}
    </tbody></table></div>`, [{ t: 'Fechar', primary: true }], '', ov => {
    $$('tr[data-i]', ov).forEach(tr => tr.onclick = () => { fechar(); const x = l[tr.dataset.i]; formAtendimento(x._doc || x); });
  });
}

async function exportarExcel() {
  if (!window.ExcelJS) return toast('Aguarde o carregamento e tente de novo.', true);
  toast('Gerando planilha…');
  let lista; try { 
    let docs = await docsDoMes(S.mes, true);
    docs = filtrarChamadosPorPerfil(docs);
    lista = explodir(docs, S.mes); 
  } catch (e) { return toast(e.message, true); }
  const p = montarPainel(S.mes, lista);
  const wb = new ExcelJS.Workbook();
  const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  const cinza = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7ECF2' } };
  const ln = { style: 'thin', color: { argb: 'FFB8C2CC' } }; const borda = { top: ln, left: ln, bottom: ln, right: ln };
  const cab = c => { c.fill = azul; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = borda; };
  const toDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : null; };

  const ws = wb.addWorksheet('PAINEL');
  ws.getCell('A1').value = 'DASHBOARD =>  ATENDIMENTO TÉCNICO FIELD'; ws.getCell('A1').font = { bold: true, size: 14 };
  const [yy, mm] = S.mes.split('-').map(Number);
  ws.getCell('B2').value = new Date(Date.UTC(yy, mm - 1, 1)); ws.getCell('B2').numFmt = 'mmm/yyyy';
  ws.getCell('E2').value = `Gerado em ${new Date().toLocaleString('pt-BR')}`;
  ['TÉCNICO', 'ENCAMINHADO', 'TENT CONTATO', 'AGENDADO', 'FECHADO', 'DEVOLVIDO', 'REMOTO/HOME', 'LOCAL', 'TOTAL GERAL (sem tent. contato)', 'CHAMADOS (SMAX diferentes)', 'HORAS TOTAIS', 'TEMPO MÉDIO', 'HORAS EM TENT.', 'MÉDIA POR TENT.'].forEach((h, i) => { const c = ws.getCell(3, 2 + i); c.value = h; cab(c); });
  [...p.linhas, p.total].forEach((r, i) => {
    [r.nome, r.encaminhado, r.tent_contato, r.agendado, r.fechado, r.devolvido, r.home, r.local, r.total, r.chamados,
      r.com_tempo ? r.min_total / 1440 : '', r.min_medio !== null ? r.min_medio / 1440 : '',
      r.tent_com_tempo ? r.tent_min_total / 1440 : '', r.tent_min_medio !== null ? r.tent_min_medio / 1440 : ''].forEach((v, j) => {
      const c = ws.getCell(4 + i, 2 + j); c.value = v; c.border = borda; if (j) c.alignment = { horizontal: 'center' };
      if (j >= 10 && v !== '') c.numFmt = '[h]:mm';
      if (r === p.total) { c.font = { bold: true }; c.fill = cinza; }
    });
  });
  ws.getCell('Q3').value = 'MÉDIA DIÁRIA'; cab(ws.getCell('Q3')); ws.getCell('R3').value = p.mediaDiaria; ws.getCell('R3').border = borda;
  ws.getCell('Q5').value = 'MIN. POR DIA'; cab(ws.getCell('Q5')); ws.getCell('R5').value = p.diasUteis ? Math.round((p.total.min_total || 0) / p.diasUteis) : 0; ws.getCell('R5').border = borda;
  ws.getCell('Q4').value = `(${p.diasUteis} dias úteis)`; ws.getCell('O4').font = { italic: true, size: 9 };
  ws.getCell('T3').value = 'ATENDIMENTO SAJ'; cab(ws.getCell('T3')); ws.getCell('U3').value = 'QTD'; cab(ws.getCell('U3'));
  p.destinos.forEach((d, i) => { ws.getCell(4 + i, 20).value = d.destino; ws.getCell(4 + i, 21).value = d.n; ws.getCell(4 + i, 20).border = borda; ws.getCell(4 + i, 21).border = borda; });
  if (p.devolucoes.length) {
    ws.getCell('W3').value = 'DEVOLVIDO POR'; cab(ws.getCell('W3')); ws.getCell('X3').value = 'QTD'; cab(ws.getCell('X3')); ws.getCell('Y3').value = 'MOTIVOS'; cab(ws.getCell('Y3'));
    p.devolucoes.forEach((g, i) => { [g.setor, g.n, Object.entries(g.motivos).map(([m, n]) => `${m} (${n})`).join(', ')].forEach((v, j) => { const c = ws.getCell(4 + i, 23 + j); c.value = v; c.border = borda; }); });
    ws.getColumn(23).width = 16; ws.getColumn(25).width = 40;
  }
  ws.getColumn(2).width = 18; for (let c = 3; c <= 15; c++) ws.getColumn(c).width = 14; ws.getColumn(17).width = 14; ws.getColumn(20).width = 18;

  const wt = wb.addWorksheet('TENTATIVAS POR DIA');
  ['DATA', 'TÉCNICO', 'TENTATIVAS', 'HORAS', 'MÉDIA POR TENTATIVA'].forEach((h, i) => { const c = wt.getCell(1, 1 + i); c.value = h; cab(c); });
  const grupos = {};
  lista.filter(a => !contaComoAtendido(a)).forEach(a => { const k = (a.data_ref || '') + '|' + a.uid; (grupos[k] = grupos[k] || []).push(a); });
  Object.keys(grupos).sort().forEach((k, i) => {
    const [d, uid] = k.split('|'), g = grupos[k], t = {}; temposTent(t, g);
    const [y2, m2, d2] = d.split('-').map(Number);
    const row = [new Date(Date.UTC(y2, m2 - 1, d2)), nomeDe(uid, g[0].tecnico), g.length, t.tent_com_tempo ? t.tent_min_total / 1440 : '', t.tent_min_medio !== null ? t.tent_min_medio / 1440 : ''];
    row.forEach((v, j) => { const c = wt.getCell(2 + i, 1 + j); c.value = v; c.border = borda; if (j === 0) c.numFmt = 'dd/mm/yyyy'; if (j >= 3 && v !== '') c.numFmt = '[h]:mm'; });
  });
  [14, 20, 12, 12, 20].forEach((wd, i) => wt.getColumn(i + 1).width = wd);
  wt.views = [{ state: 'frozen', ySplit: 1 }];

  const usados = new Set();
  for (const lin of p.linhas) {
    let nomeAba = lin.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    while (usados.has(nomeAba.toLowerCase())) nomeAba = nomeAba.slice(0, 27) + ' ' + usados.size;
    usados.add(nomeAba.toLowerCase());
    const w = wb.addWorksheet(nomeAba);
    ['Solicitação SMAX', 'Comarca', 'Inicio Atendimento', 'Termino Atendimento', 'Tempo Atendimento', 'Ticket Softplan', 'STATUS', 'Encaminhado para', 'HOME/LOCAL', 'Usuário', 'Obs', 'Histórico']
      .forEach((h, i) => { const c = w.getCell(1, 1 + i); c.value = h; cab(c); });
    w.getRow(1).height = 30;
    const meus = lista.filter(a => a.uid === lin.uid).sort((a, b) => (a.inicio || a.data_ref).localeCompare(b.inicio || b.data_ref));
    meus.forEach((a, i) => {
      const r = 2 + i, ini = toDate(a.inicio), fim = toDate(a.termino);
      w.getCell(r, 1).value = (a._ida || a.ida || 1) > 1 ? `${a.smax} (${ordinal(a._ida || a.ida)})` : a.smax; w.getCell(r, 2).value = a.comarca;
      if (ini) { w.getCell(r, 3).value = ini; w.getCell(r, 3).numFmt = 'dd/mm/yyyy hh:mm'; }
      if (fim) { w.getCell(r, 4).value = fim; w.getCell(r, 4).numFmt = 'dd/mm/yyyy hh:mm'; }
      if (ini && fim) { w.getCell(r, 5).value = { formula: `D${r}-C${r}` }; w.getCell(r, 5).numFmt = '[h]:mm'; }
      w.getCell(r, 6).value = a.ticket_softplan; w.getCell(r, 7).value = a._fechada && a.devolucao ? `DEVOLVIDO (${a._statusOrig || 'sem status'}) — ${a.devolucao.motivo || ''}` : a.status; w.getCell(r, 8).value = a.encaminhado_para;
      w.getCell(r, 9).value = a.home_local; w.getCell(r, 10).value = a.usuario_atendido; w.getCell(r, 11).value = a.obs;
      w.getCell(r, 12).value = (a.historico || []).map(e => `${fmtData(e.em)} ${(e.em || '').slice(11, 16)} ${e.por || ''}: ${e.de && e.de !== e.para ? e.de + ' → ' : ''}${e.para || ''}${e.obs ? ' — ' + e.obs : ''}`).join('\n');
      w.getCell(r, 12).alignment = { wrapText: true, vertical: 'top' };
      for (let c = 1; c <= 12; c++) w.getCell(r, c).border = borda;
    });
    w.getCell('P2').value = 'TOTAIS'; cab(w.getCell('P2')); cab(w.getCell('Q2'));
    [['ENCAMINHADO', lin.encaminhado], ['TENT CONTATO', lin.tent_contato], ['AGENDADO', lin.agendado], ['FECHADO', lin.fechado], ['DEVOLVIDO', lin.devolvido], ['HOME', lin.home], ['LOCAL', lin.local], ['TOTAL (sem tent. contato)', lin.total]]
      .forEach(([k, v], i) => { const a = w.getCell(3 + i, 16), b = w.getCell(3 + i, 17); a.value = k; b.value = v; a.border = b.border = borda; if (k.startsWith('TOTAL')) a.font = b.font = { bold: true }; });
    w.getCell('S1').value = 'Agendamento'; w.getCell('S1').font = { bold: true };
    ['Horário', 'SMAX', 'Usuário', 'Obs'].forEach((h, i) => { const c = w.getCell(2, 19 + i); c.value = h; cab(c); });
    meus.filter(a => a.status === 'AGENDADO').forEach((a, i) => {
      const d = toDate(a.agendamento); if (d) { w.getCell(3 + i, 19).value = d; w.getCell(3 + i, 19).numFmt = 'dd/mm hh:mm'; }
      w.getCell(3 + i, 20).value = a.smax; w.getCell(3 + i, 21).value = a.usuario_atendido; w.getCell(3 + i, 22).value = a.obs;
    });
    [18, 22, 18, 18, 14, 16, 15, 17, 12, 22, 40, 60, 2, 2, 2, 15, 8, 2, 14, 16, 20, 30].forEach((wd, i) => w.getColumn(i + 1).width = wd);
    w.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `atendimentos-${S.mes}.xlsx` });
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// --------------------------------------------------------------- Usuários (líder)
async function telaUsuarios(main) {
  S.recarregar = null;
  try { S.usuarios = await api.listarUsuarios(); } catch (e) { toast(e.message, true); }
  const lista = S.usuarios.filter(u => !u.desligado).sort((a, b) => (a.ativo - b.ativo) || a.nome.localeCompare(b.nome));
  const deslig = S.usuarios.filter(u => u.desligado).sort((a, b) => (b.desligado_em || '').localeCompare(a.desligado_em || ''));
  const link = location.href.split('#')[0];
  main.innerHTML = `<div class="head"><div><h2>Usuários</h2>
      <p>Para entrar alguém novo: mande o link do sistema, a pessoa cria a conta com o e-mail ${api.DOMINIOS.map(d => '@' + esc(d)).join(' ou ')} e você libera aqui.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="cop">Copiar convite</button><button class="btn" id="imp">Importar planilha antiga</button></div></div>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>
    ${lista.map(u => {
      const eu = u.id === S.perfil.id;
      const situacao = u.ativo ? '<span class="chip FECHADO">Ativo</span>' : (u.bloqueado ? '<span class="chip">Bloqueado</span>' : '<span class="chip TENT">Aguardando liberação</span>');
      return `<tr data-id="${esc(u.id)}">
      <td><b>${esc(u.nome)}</b>${eu ? ' <span class="muted">(você)</span>' : ''}</td><td>${esc(u.email)}</td>
      <td><select data-acao="perfil" ${eu ? 'disabled' : ''} style="width:auto;height:30px"><option value="tecnico" ${u.perfil === 'tecnico' ? 'selected' : ''}>Técnico</option><option value="admin" ${u.perfil === 'admin' ? 'selected' : ''}>Líder / admin</option></select></td>
      <td>${situacao}</td>
      <td style="text-align:right;white-space:nowrap">${eu ? '' : `${u.ativo ? '<button class="btn sm" data-acao="bloquear">Bloquear</button>' : '<button class="btn sm primary" data-acao="liberar">Liberar acesso</button>'}
        <button class="btn sm danger" data-acao="desligar">Desligar da equipe</button>`}</td></tr>`;
    }).join('')}</tbody></table></div></div>
    <p class="hint" style="margin-top:12px"><b>Bloquear</b> = pausa temporária (férias, afastamento): a pessoa não entra, mas continua aparecendo nas telas.
      <b>Desligar</b> = saiu da equipe: não entra e some das telas, mas todos os atendimentos dela continuam guardados e contando nos meses em que trabalhou.</p>
    ${deslig.length ? `<details class="card desligados"><summary>Desligados (${deslig.length})</summary><div class="tablewrap"><table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Desligado em</th><th>Por</th><th></th></tr></thead><tbody>
      ${deslig.map(u => `<tr data-id="${esc(u.id)}"><td><b>${esc(u.nome)}</b></td><td>${esc(u.email)}</td><td>${fmtData(u.desligado_em)} ${esc((u.desligado_em || '').slice(11, 16))}</td><td>${esc(u.desligado_por || '')}</td>
        <td style="text-align:right"><button class="btn sm" data-acao="reativar">Reativar</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="pad hint">Para liberar o e-mail de vez, apague a conta em Firebase → Authentication → Usuários. Os atendimentos não são afetados.</div></details>` : ''}
    <div class="card comarcas-card">
      <h3>Comarcas atendidas <span class="muted">· ${listaComarcas().length}</span></h3>
      <div class="pad">
        <p class="hint" style="margin-top:0">Só as comarcas desta lista podem ser usadas nos atendimentos, sempre com o mesmo nome. Quem digitar "ATIBAIA" ou "atibaia" grava "Atibaia".
          Qualquer técnico pode cadastrar uma comarca nova pelo formulário; remover e padronizar fica com o líder.</p>
        <div class="com-add"><input type="text" id="novaCom" placeholder="Nova comarca, ex.: Bragança Paulista"><button class="btn primary" id="addCom2">Adicionar</button></div>
        <div class="com-lista">${listaComarcas().length ? listaComarcas().map(c => `<span class="com-chip">${esc(c)}<button type="button" data-rem="${esc(c)}" title="Remover ${esc(c)}" aria-label="Remover ${esc(c)}">×</button></span>`).join('') : '<span class="muted">Lista vazia. Use "Montar lista a partir dos atendimentos" para começar com as comarcas que vocês já usam.</span>'}</div>
        <div class="com-acoes">
          <button class="btn" id="sugCom">Montar lista a partir dos atendimentos</button>
          <button class="btn" id="padCom" ${listaComarcas().length ? '' : 'disabled'}>Padronizar atendimentos antigos</button>
        </div>
        <div id="comRes"></div>
      </div>
    </div>
    <input type="file" id="arq" accept=".xlsx" hidden>`;
  $('#cop').onclick = async () => {
    const msg = `Acesse o sistema de atendimentos: ${link}\nClique em "Primeiro acesso? Criar conta", use seu e-mail da empresa e confirme pelo link que chega no Outlook. Depois me avise que eu libero seu acesso.`;
    try { await navigator.clipboard.writeText(msg); toast('Convite copiado. Cole no WhatsApp/Teams.'); } catch { prompt('Copie o convite:', msg); }
  };
  $('#imp').onclick = () => $('#arq').click();
  $('#arq').onchange = importar;
  const recarregar = () => render();
  const adicionar = async () => {
    const v = $('#novaCom').value.trim(); if (!v) return;
    if (comarcaOficial(v)) { toast(`"${comarcaOficial(v)}" já está na lista.`); return; }
    try { await salvarListaComarcas([...listaComarcas(), v]); toast(`"${tituloComarca(v)}" adicionada.`); recarregar(); } catch (e) { toast(e.message, true); }
  };
  $('#addCom2').onclick = adicionar;
  $('#novaCom').onkeydown = e => { if (e.key === 'Enter') adicionar(); };
  $$('[data-rem]', main).forEach(b => b.onclick = async () => {
    if (!confirm(`Remover "${b.dataset.rem}" da lista? Os atendimentos antigos não mudam, mas ela deixa de poder ser escolhida.`)) return;
    try { await salvarListaComarcas(listaComarcas().filter(c => c !== b.dataset.rem)); recarregar(); } catch (e) { toast(e.message, true); }
  });
  $('#sugCom').onclick = async () => {
    let todos; try { todos = await api.listarTodosAtendimentos(); } catch (e) { return toast(e.message, true); }
    const grupos = new Map();
    todos.forEach(a => { const k = chaveComarca(a.comarca); if (!k || k === '(nao informada)') return; const g = grupos.get(k) || []; g.push(a.comarca.trim()); grupos.set(k, g); });
    const sugestao = [...grupos.values()].map(g => tituloComarca(g.find(v => /[^\x00-\x7f]/.test(v)) || g[0]));
    const novas = sugestao.filter(c => !comarcaOficial(c));
    if (!novas.length) return toast('Todas as comarcas usadas já estão na lista.');
    if (!confirm(`Adicionar ${novas.length} comarca(s) encontradas nos atendimentos?\n\n${novas.join(', ')}\n\nDepois você pode remover as que estiverem erradas.`)) return;
    try { await salvarListaComarcas([...listaComarcas(), ...novas]); toast(`${novas.length} comarca(s) adicionadas.`); recarregar(); } catch (e) { toast(e.message, true); }
  };
  $('#padCom').onclick = async () => {
    let todos; try { todos = await api.listarTodosAtendimentos(); } catch (e) { return toast(e.message, true); }
    const corrigir = [], fora = new Map();
    todos.forEach(a => {
      const ofi = comarcaOficial(a.comarca);
      if (ofi && ofi !== a.comarca) corrigir.push({ id: a.id, comarca: ofi });
      else if (!ofi && a.comarca) fora.set(tituloComarca(a.comarca), (fora.get(tituloComarca(a.comarca)) || 0) + 1);
    });
    const foraTxt = fora.size ? `<div class="err" style="margin-top:10px">${[...fora.values()].reduce((t, n) => t + n, 0)} atendimento(s) usam comarcas que <b>não estão na lista</b> e ficaram como estão: ${[...fora.entries()].map(([c, n]) => `${esc(c)} (${n})`).join(', ')}. Se forem comarcas válidas, adicione na lista e padronize de novo.</div>` : '';
    if (!corrigir.length) { $('#comRes').innerHTML = `<p class="hint">Nada para corrigir: os atendimentos já usam os nomes da lista.</p>${foraTxt}`; return; }
    if (!confirm(`Corrigir o nome da comarca em ${corrigir.length} atendimento(s) para o nome oficial da lista?`)) return;
    try { await api.atualizarComarcas(corrigir); $('#comRes').innerHTML = `<p class="hint"><b>${corrigir.length}</b> atendimento(s) padronizados.</p>${foraTxt}`; toast('Comarcas padronizadas.'); }
    catch (e) { toast(e.message, true); }
  };

  $$('tr[data-id]', main).forEach(tr => {
    const u = S.usuarios.find(x => x.id === tr.dataset.id);
    const mudar = async (dados, msg) => { try { await api.atualizarUsuario(u.id, dados); toast(msg); S.usuarios = null; render(); } catch (e) { toast(e.message, true); } };
    const pf = $('[data-acao=perfil]', tr); if (pf) pf.onchange = () => mudar({ perfil: pf.value }, 'Perfil atualizado.');
    const lib = $('[data-acao=liberar]', tr); if (lib) lib.onclick = () => mudar({ ativo: true, bloqueado: false }, `${u.nome} liberado.`);
    const blq = $('[data-acao=bloquear]', tr); if (blq) blq.onclick = () => confirm(`Bloquear ${u.nome}? Ele não conseguirá mais acessar.`) && mudar({ ativo: false, bloqueado: true }, `${u.nome} bloqueado.`);
    const des = $('[data-acao=desligar]', tr); if (des) des.onclick = () => desligarUsuario(u);
    const rea = $('[data-acao=reativar]', tr); if (rea) rea.onclick = () => confirm(`Reativar ${u.nome}? Ele volta a aparecer na equipe e pode entrar no sistema.`) &&
      mudar({ ativo: true, bloqueado: false, desligado: false, desligado_em: '', desligado_por: '' }, `${u.nome} reativado.`);
  });
}

const ABERTOS = ['AGENDADO', 'TENT CONTATO', 'ENCAMINHADO'];
async function desligarUsuario(u) {
  let todos;
  try { todos = (await api.listarPorTecnico(u.id)).filter(foraDaLixeira); } catch (e) { return toast(e.message, true); }
  const abertos = todos.filter(a => ABERTOS.includes(a.status));
  const destinos = S.usuarios.filter(x => x.ativo && !x.desligado && x.id !== u.id).sort((a, b) => a.nome.localeCompare(b.nome));
  modal(`Desligar ${esc(u.nome)} da equipe`, `<form novalidate><div id="e"></div>
    <p style="margin-top:0">${esc(u.nome)} vai <b>perder o acesso</b> e <b>sair das listas e seletores</b> do sistema.</p>
    <ul class="lista-ok">
      <li><b>${todos.length}</b> atendimento(s) registrados por ele continuam guardados, no Painel dos meses em que trabalhou e no Excel.</li>
      <li>Dá para desfazer depois em <b>Usuários → Desligados → Reativar</b>.</li>
    </ul>
    ${abertos.length ? `<div class="aviso-abertos">
      <b>${abertos.length} chamado(s) ainda em aberto</b> com ele:
      ${ABERTOS.map(st => { const n = abertos.filter(a => a.status === st).length; return n ? `<span class="nowrap">${chip(st)} <b>${n}</b></span>` : ''; }).filter(Boolean).join(' · ')}
      <div class="lista-abertos">${abertos.slice(0, 8).map(a => `<div>SMAX <b>${esc(a.smax)}</b> · ${esc(a.comarca)}${a.agendamento ? ' · agendado ' + fmtDH(a.agendamento) : ''}</div>`).join('')}${abertos.length > 8 ? `<div class="muted">… e mais ${abertos.length - 8}</div>` : ''}</div>
      <label class="f" style="margin-top:10px"><span>Transferir os chamados em aberto para</span>
        <select name="destino"><option value="">Não transferir (deixar no nome dele)</option>${destinos.map(d => `<option value="${esc(d.id)}">${esc(d.nome)}</option>`).join('')}</select></label>
      <div class="hint">A transferência fica registrada no histórico de cada chamado. Chamados fechados continuam no nome dele.</div>
    </div>` : '<p class="hint">Ele não tem chamados em aberto.</p>'}
  </form>`, [{ t: 'Cancelar' }, { t: 'Desligar', danger: false, primary: true, fn: async ov => {
    const destino = abertos.length ? $('select[name=destino]', ov).value : '';
    try {
      if (destino) {
        const nomeDest = nomeDe(destino);
        await api.transferirAtendimentos(abertos.map(a => ({
          id: a.id, uid: destino, tecnico: nomeDest, uids: unicos([...(a.uids || [a.uid]), destino]),
          historico: [...(Array.isArray(a.historico) ? a.historico : []), { em: agoraLocal(), por: S.perfil.nome, de: a.status, para: a.status,
            obs: `Transferido de ${u.nome} para ${nomeDest} (desligamento da equipe).` }].slice(-300),
        })));
      }
      await api.atualizarUsuario(u.id, { ativo: false, bloqueado: false, desligado: true, desligado_em: agoraLocal(), desligado_por: S.perfil.nome });
      toast(`${u.nome} desligado.${destino ? ` ${abertos.length} chamado(s) transferido(s) para ${nomeDe(destino)}.` : ''}`);
      S.usuarios = null; render(); return true;
    } catch (e) { erroBox($('#e', ov), e.message); return false; }
  } }], 'sm');
}

async function idImportacao(uid, at) {
  const bytes = new TextEncoder().encode([uid, at.smax, at.inicio, at.comarca].join('|'));
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return 'imp_' + [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
function normNome(n) { return s(n).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'); }

async function importar(ev) {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  if (!window.XLSX) return toast('Aguarde o carregamento e tente de novo.', true);
  toast('Lendo a planilha…');
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', sheetRows: 20000, cellFormula: false, cellStyles: false });
    const resumo = { porAba: {}, semTecnico: [], novos: 0, jaExistiam: 0 };
    const itens = [];
    for (const aba of wb.SheetNames) {
      if (/painel/i.test(aba)) continue;
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: '' });
      if (!linhas.length || !s(linhas[0][0]).toLowerCase().includes('smax')) continue;
      const u = S.usuarios.find(x => normNome(x.nome) === normNome(aba)) || S.usuarios.find(x => normNome(x.nome.split(' ')[0]) === normNome(aba));
      if (!u) { resumo.semTecnico.push(aba); continue; }
      let n = 0;
      for (const row of linhas.slice(1)) {
        if (!s(row[0]) && !s(row[1])) continue;
        const at = montarAtendimento({ smax: row[0], comarca: row[1], inicio: row[2], termino: row[3], ticket_softplan: row[5], status: row[6], encaminhado_para: row[7], home_local: row[8] }, u.id, u.nome);
        at.comarca = at.comarca ? nomeComarca(at.comarca) : '(não informada)';
        itens.push({ id: await idImportacao(u.id, at), dados: at }); n++;
      }
      resumo.porAba[aba] = n;
    }
    const existentes = await api.idsExistentes(itens.map(i => i.id));
    const novos = itens.filter(i => !existentes.has(i.id));
    resumo.jaExistiam = itens.length - novos.length; resumo.novos = novos.length;
    if (novos.length) { toast(`Gravando ${novos.length} atendimento(s)…`); await api.gravarLote(novos); }
    const abas = Object.entries(resumo.porAba).map(([k, v]) => `<li>${esc(k)}: ${v} linha(s)</li>`).join('');
    modal('Importação concluída', `<p><b>${resumo.novos}</b> atendimento(s) importado(s).${resumo.jaExistiam ? ` ${resumo.jaExistiam} já existiam e foram ignorados.` : ''}</p>
      ${abas ? `<ul>${abas}</ul>` : ''}
      ${resumo.semTecnico.length ? `<div class="err">Abas sem técnico com esse nome (não importadas): ${esc(resumo.semTecnico.join(', '))}. Quando a pessoa criar a conta com o mesmo nome da aba, importe de novo — o que já entrou não duplica.</div>` : ''}`,
      [{ t: 'OK', primary: true }], 'sm');
  } catch (e) { console.error(e); toast(e.message || 'Não consegui ler esse arquivo.', true); }
}
