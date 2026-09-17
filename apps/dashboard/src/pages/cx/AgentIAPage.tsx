import React, { useState, useEffect, useRef } from 'react';
import PageHeader from '../../components/ui/PageHeader';
import TabsNavigation from '../../components/ui/TabsNavigation';
import { agencesApi } from '../../services/api';
import type { Agence } from '../../types';
import {
  SparklesIcon,
  MessageSquareIcon,
  ClockIcon,
  StoreIcon,
  CopyIcon,
  CheckIcon,
  FilterIcon,
  TargetIcon,
  LightbulbIcon,
  SendIcon,
} from '../../components/common/Icons';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  intention?: string;
  recommandations?: string[];
  sources?: { agence: string; count: number; theme: string }[];
}

interface SavedConversation {
  id: string;
  titre: string;
  date: string;
  agence: string;
  dernierMessage: string;
  messages: ChatMessage[];
}

const QUICK_SUGGESTIONS = [
  "Pourquoi la satisfaction à Tunis Bourguiba a-t-elle baissé ce mois-ci ?",
  "Quels sont les principaux motifs d'insatisfaction sur le réseau ?",
  "Génère un plan d'action pour réduire l'attente en agence.",
  "Résume les avis positifs récents sur l'accueil des conseillers.",
];

export default function AgentIAPage() {
  const [activeTab, setActiveTab] = useState<'copilot' | 'historique'>('copilot');
  const [selectedAgence, setSelectedAgence] = useState<string>('all');
  const [selectedPeriode, setSelectedPeriode] = useState<number>(30);
  const [agences, setAgences] = useState<Agence[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string>('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'assistant',
      text: "Bonjour ! Je suis votre Copilot IA IKAN. Je peux analyser les retours clients de vos agences, détecter des anomalies sémantiques ou générer des plans d'action personnalisés. Que souhaitez-vous analyser ?",
      timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const [history, setHistory] = useState<SavedConversation[]>([
    {
      id: 'h1',
      titre: "Diagnostic de l'attente en caisse — Agence Tunis",
      date: 'Hier, 14:32',
      agence: 'Agence Tunis Bourguiba',
      dernierMessage: "Plan d'action proposé : ouverture d'une borne rapide et renfort aux heures de pointe (12h-14h).",
      messages: [],
    },
    {
      id: 'h2',
      titre: "Synthèse mensuelle des réclamations Fibre & 4G",
      date: '28 Août 2026',
      agence: 'Toutes les agences',
      dernierMessage: "85% des réclamations réseau concernent la couverture en zone périurbaine.",
      messages: [],
    },
    {
      id: 'h3',
      titre: "Benchmark satisfaction accueil conseillers",
      date: '24 Août 2026',
      agence: 'Réseau National',
      dernierMessage: "Score d'accueil global maintenu à 88% de satisfaction.",
      messages: [],
    },
  ]);

  useEffect(() => {
    agencesApi.list().then((res) => {
      if (Array.isArray(res.data)) setAgences(res.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage('');
    setLoading(true);

    setTimeout(() => {
      const agenceNom = selectedAgence === 'all'
        ? 'l’ensemble du réseau'
        : agences.find((a) => a.id === selectedAgence)?.nom || 'l’agence sélectionnée';

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: `D’après l’analyse sémantique sur ${agenceNom} (${selectedPeriode} derniers jours), les clients expriment une satisfaction générale de 78%. Le principal point de friction identifié concerne le temps d'attente estimé à plus de 15 minutes lors des pics d'affluence.`,
        timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        intention: "Analyse de performance & Diagnostic sémantique",
        recommandations: [
          "Déployer un système de file d’attente digitale prioritaire",
          "Renforcer l'effectif aux guichets entre 12h00 et 14h30",
          "Former les agents d'accueil à l'orientation rapide vers les bornes libre-service"
        ],
        sources: [
          { agence: agenceNom, count: 18, theme: "Temps d'attente & Délais" },
          { agence: agenceNom, count: 9, theme: "Accueil & Courtoisie" }
        ],
      };

      setMessages((prev) => [...prev, botMsg]);
      setLoading(false);
    }, 1000);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const tabsConfig = [
    { id: 'copilot', label: 'Copilot IA', icon: <SparklesIcon size={16} color="#75B72A" /> },
    { id: 'historique', label: 'Historique des analyses', icon: <ClockIcon size={16} />, badge: history.length },
  ];

  return (
    <div
      style={{
        padding: '0 36px 48px',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <PageHeader
        title="Agent IA & Copilot"
        subtitle="Assistant conversationnel spécialisé dans l'analyse de l'expérience client"
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#EBF6ED', padding: '6px 14px', borderRadius: '9999px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3C7730', display: 'inline-block' }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#3C7730' }}>Modèle IKAN AI Connecté</span>
        </div>
      </PageHeader>

      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* ── ONGLET 1 : COPILOT (Chat Épuré & Central) ── */}
      {activeTab === 'copilot' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            maxWidth: '1000px',
            margin: '0 auto',
            width: '100%',
          }}
        >
          {/* Barre de filtres contextuels */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#FFFFFF',
              padding: '12px 18px',
              borderRadius: '16px',
              border: '1px solid #E2E8F0',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <StoreIcon size={16} color="#3C7730" />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>Périmètre :</span>
              <select
                value={selectedAgence}
                onChange={(e) => setSelectedAgence(e.target.value)}
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '10px',
                  padding: '6px 12px',
                  fontSize: '0.80rem',
                  fontWeight: 600,
                  color: '#02302D',
                  outline: 'none',
                }}
              >
                <option value="all">Toutes les agences</option>
                {agences.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.nom}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {[
                { v: 7, l: '7 jours' },
                { v: 30, l: '30 jours' },
                { v: 90, l: '90 jours' },
              ].map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setSelectedPeriode(p.v)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '8px',
                    fontSize: '0.76rem',
                    fontWeight: selectedPeriode === p.v ? 700 : 500,
                    background: selectedPeriode === p.v ? '#02302D' : '#F1F5F9',
                    color: selectedPeriode === p.v ? '#FFFFFF' : '#64748B',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {p.l}
                </button>
              ))}
            </div>
          </div>

          {/* Zone de Chat principale */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '24px',
              border: '1px solid #E8ECE6',
              boxShadow: '0 2px 12px rgba(20, 60, 40, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: '520px',
              height: 'calc(100vh - 360px)',
              overflow: 'hidden',
            }}
          >
            {/* Messages Scrollables */}
            <div
              style={{
                flex: 1,
                padding: '24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
              }}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      maxWidth: '82%',
                      padding: '16px 20px',
                      borderRadius: msg.sender === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                      background: msg.sender === 'user' ? '#02302D' : '#F8FAFC',
                      color: msg.sender === 'user' ? '#FFFFFF' : '#0F172A',
                      border: msg.sender === 'user' ? 'none' : '1px solid #E2E8F0',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.02)',
                      fontSize: '0.88rem',
                      lineHeight: 1.5,
                    }}
                  >
                    <div>{msg.text}</div>

                    {/* Intention et Recommandations */}
                    {msg.recommandations && msg.recommandations.length > 0 && (
                      <div
                        style={{
                          marginTop: '14px',
                          paddingTop: '12px',
                          borderTop: '1px solid #E2E8F0',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 800, color: '#3C7730', marginBottom: '8px' }}>
                          <LightbulbIcon size={15} color="#3C7730" />
                          Recommandations d'actions immédiates :
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.82rem', color: '#334155' }}>
                          {msg.recommandations.map((rec, i) => (
                            <li key={i} style={{ marginBottom: '4px' }}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Sources et avis analysés */}
                    {msg.sources && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                        {msg.sources.map((src, i) => (
                          <span
                            key={i}
                            style={{
                              background: '#EBF6ED',
                              color: '#3C7730',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                            }}
                          >
                            📊 {src.count} avis analysés ({src.theme})
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Footer du message */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: '8px',
                        fontSize: '0.70rem',
                        color: msg.sender === 'user' ? '#94A3B8' : '#64748B',
                      }}
                    >
                      <span>{msg.timestamp}</span>
                      {msg.sender === 'assistant' && (
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.text, msg.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#64748B',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                          }}
                        >
                          {copiedId === msg.id ? <CheckIcon size={12} color="#3C7730" /> : <CopyIcon size={12} />}
                          {copiedId === msg.id ? 'Copié' : 'Copier'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#64748B', fontSize: '0.84rem' }}>
                  <div style={{ width: '16px', height: '16px', border: '2px solid #3C7730', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                  L'IA analyse les verbatims et corrélations...
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Suggestions Rapides */}
            <div
              style={{
                padding: '10px 20px',
                background: '#FAFCFA',
                borderTop: '1px solid #E8ECE6',
                display: 'flex',
                gap: '8px',
                overflowX: 'auto',
                scrollbarWidth: 'none',
              }}
            >
              {QUICK_SUGGESTIONS.map((sug, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendMessage(sug)}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #D6E8D9',
                    borderRadius: '9999px',
                    padding: '5px 12px',
                    fontSize: '0.76rem',
                    color: '#02302D',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#EBF6ED')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
                >
                  💡 {sug}
                </button>
              ))}
            </div>

            {/* Barre de saisie */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              style={{
                padding: '16px 20px',
                background: '#FFFFFF',
                borderTop: '1px solid #E8ECE6',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <input
                type="text"
                placeholder="Posez une question sur vos avis clients, tendances ou agences..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                style={{
                  flex: 1,
                  border: '1px solid #E2E8F0',
                  borderRadius: '14px',
                  padding: '12px 18px',
                  fontSize: '0.88rem',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || loading}
                style={{
                  background: inputMessage.trim() ? '#02302D' : '#E2E8F0',
                  color: inputMessage.trim() ? '#FFFFFF' : '#94A3B8',
                  border: 'none',
                  borderRadius: '14px',
                  padding: '12px 20px',
                  fontSize: '0.86rem',
                  fontWeight: 700,
                  cursor: inputMessage.trim() ? 'pointer' : 'default',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                Envoyer
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── ONGLET 2 : HISTORIQUE ── */}
      {activeTab === 'historique' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
          {/* Recherche */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="text"
              placeholder="Rechercher une conversation ou une agence..."
              value={searchHistory}
              onChange={(e) => setSearchHistory(e.target.value)}
              style={{
                flex: 1,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '14px',
                padding: '12px 18px',
                fontSize: '0.86rem',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {history
              .filter((h) => h.titre.toLowerCase().includes(searchHistory.toLowerCase()) || h.agence.toLowerCase().includes(searchHistory.toLowerCase()))
              .map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setActiveTab('copilot')}
                  style={{
                    background: '#FFFFFF',
                    borderRadius: '16px',
                    padding: '18px 22px',
                    border: '1px solid #E8ECE6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#3C7730';
                    e.currentTarget.style.background = '#FBFDFB';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#E8ECE6';
                    e.currentTarget.style.background = '#FFFFFF';
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#02302D' }}>{conv.titre}</span>
                      <span style={{ fontSize: '0.72rem', background: '#EBF6ED', color: '#3C7730', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                        {conv.agence}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748B' }}>
                      {conv.dernierMessage}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '0.76rem', color: '#94A3B8' }}>{conv.date}</span>
                    <button
                      type="button"
                      style={{
                        background: '#02302D',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '6px 14px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Ouvrir
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
