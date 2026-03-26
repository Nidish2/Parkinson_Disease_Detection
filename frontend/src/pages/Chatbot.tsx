import { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, User, Send, LoaderCircle, AlertCircle, Volume2, VolumeX, Sparkles, Copy, SlidersHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { postChatMessage } from '../services/api';
import Card from '../components/Card';

interface Message {
    id: string;
    from: 'bot' | 'user';
    text: string;
}

type ResponseProfileKey = keyof typeof responseProfiles;

interface FocusArea {
    id: string;
    label: string;
    description: string;
    systemInstruction: string;
    temperature?: number;
}

interface QuickPrompt {
    id: string;
    label: string;
    text: string;
    tags?: string[];
}

const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11));

const responseProfiles = {
    concise: {
        label: 'Bite-size summary',
        description: '2-3 short paragraphs with clear actions',
        maxTokens: 220,
        systemInstruction: 'Keep responses under three short paragraphs and emphasise the most actionable steps.'
    },
    balanced: {
        label: 'Balanced guidance',
        description: 'Adds context plus next steps',
        maxTokens: 420,
        systemInstruction: 'Provide a balanced response with concise context, key considerations, and practical next steps presented in short sections or bullet lists.'
    },
    detailed: {
        label: 'Deep dive',
        description: 'Expanded explanation for planning',
        maxTokens: 650,
        systemInstruction: 'Offer a structured, in-depth explanation with headings or bullet lists. Keep it focused and no more than six concise paragraphs.'
    }
} as const;

const focusAreas: FocusArea[] = [
    {
        id: 'daily',
        label: 'Daily living',
        description: 'Energy, sleep, routine adaptions',
        systemInstruction: 'Prioritise daily living strategies, adaptive routines, and practical tips for managing Parkinson\'s at home.',
        temperature: 0.55,
    },
    {
        id: 'movement',
        label: 'Movement & exercise',
        description: 'Balance, physiotherapy, stretching',
        systemInstruction: 'Focus on safe mobility, exercise, stretching routines, and evidence-based physiotherapy advice relevant to Parkinson\'s.',
        temperature: 0.65,
    },
    {
        id: 'medication',
        label: 'Medication & timing',
        description: 'Scheduling, side effects, adherence',
        systemInstruction: 'Help organise medication timing, adherence habits, and side-effect awareness without prescribing dosages.',
        temperature: 0.5,
    },
    {
        id: 'mind',
        label: 'Mood & cognition',
        description: 'Mental health, cognition, caregivers',
        systemInstruction: 'Support emotional wellbeing, cognition exercises, and caregiver collaboration for Parkinson\'s care.',
        temperature: 0.7,
    },
];

const quickPrompts: QuickPrompt[] = [
    {
        id: 'med-timing',
        label: 'Medication timing checklist',
        text: 'Can you suggest a simple checklist to help me keep Parkinson\'s medications on schedule each day?',
        tags: ['medication']
    },
    {
        id: 'balance-drills',
        label: 'Balance drills',
        text: 'What gentle balance and posture exercises are safe for someone with mid-stage Parkinson\'s?',
        tags: ['movement']
    },
    {
        id: 'sleep-health',
        label: 'Improve sleep quality',
        text: 'How can I adjust my evening routine to sleep better with Parkinson\'s?',
        tags: ['daily']
    },
    {
        id: 'stress-reset',
        label: 'Calm anxious moments',
        text: 'Share a brief breathing or mindfulness routine to steady tremors when I feel stressed.',
        tags: ['mind']
    },
    {
        id: 'clinic-prep',
        label: 'Prep for neurologist visit',
        text: 'What questions should I prepare before my next neurologist appointment regarding Parkinson\'s progression?',
        tags: ['medication', 'daily']
    },
    {
        id: 'care-partner',
        label: 'Support for care-partner',
        text: 'How can my care-partner and I share responsibilities without burning out?',
        tags: ['mind', 'daily']
    }
];

const Chatbot = () => {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: generateId(),
            from: 'bot',
            text: 'Hello! I\'m your Parkinson\'s care assistant. Ask me about daily routines, symptom management, or how to prepare for appointments, and I\'ll keep the guidance focused and easy to act on.'
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [responseProfile, setResponseProfile] = useState<ResponseProfileKey>('concise');
    const [selectedFocus, setSelectedFocus] = useState<string>(focusAreas[0].id);
    const [autoSpeak, setAutoSpeak] = useState(false);
    const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const lastSpokenRef = useRef<string | null>(null);
    const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    useEffect(() => {
        if (!speechSupported) return;
        return () => {
            window.speechSynthesis.cancel();
        };
    }, [speechSupported]);

    useEffect(() => {
        if (!autoSpeak || !speechSupported || loading) return;
        const lastBotMessage = [...messages].reverse().find(msg => msg.from === 'bot');
        if (lastBotMessage && lastBotMessage.id !== lastSpokenRef.current) {
            speakMessage(lastBotMessage);
        }
    }, [messages, autoSpeak, speechSupported, loading]);

    const sortedPrompts = useMemo(() => {
        const matching = quickPrompts.filter(prompt => !prompt.tags || prompt.tags.includes(selectedFocus));
        const remaining = quickPrompts.filter(prompt => prompt.tags && !prompt.tags.includes(selectedFocus));
        return [...matching, ...remaining];
    }, [selectedFocus]);

    const speakMessage = (message: Message) => {
        if (!speechSupported) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message.text);
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.onend = () => {
            setSpeakingMessageId(null);
        };
        setSpeakingMessageId(message.id);
        lastSpokenRef.current = message.id;
        window.speechSynthesis.speak(utterance);
    };

    const toggleSpeakForMessage = (message: Message) => {
        if (!speechSupported) return;
        if (speakingMessageId === message.id) {
            window.speechSynthesis.cancel();
            setSpeakingMessageId(null);
        } else {
            speakMessage(message);
        }
    };

    const handleCopy = async (message: Message) => {
        try {
            await navigator.clipboard.writeText(message.text);
            setCopiedMessageId(message.id);
            setTimeout(() => setCopiedMessageId(null), 2000);
        } catch (err) {
            console.error('Copy failed:', err);
            setError('Could not copy the response.');
        }
    };

    const sendMessage = async (messageText: string) => {
        const trimmed = messageText.trim();
        if (!trimmed || loading) return;

        const userMessage: Message = { id: generateId(), from: 'user', text: trimmed };
        const updatedConversation = [...messages, userMessage];
        setMessages(updatedConversation);
        setInput('');
        setLoading(true);
        setError(null);

        const profile = responseProfiles[responseProfile];
        const focus = focusAreas.find(area => area.id === selectedFocus);
        const instructionParts = [profile.systemInstruction, focus?.systemInstruction, 'Always keep the guidance relevant to Parkinson\'s care and wellness.'];
        const options = {
            maxTokens: profile.maxTokens,
            temperature: focus?.temperature ?? 0.6,
            systemInstruction: instructionParts.filter(Boolean).join(' ')
        };

        try {
            const response = await postChatMessage(updatedConversation, options);
            const botMessageText = response.choices?.[0]?.message?.content?.trim() || "I'm sorry, I couldn't process that.";
            const botMessage: Message = { id: generateId(), from: 'bot', text: botMessageText };
            setMessages(prev => [...prev, botMessage]);
        } catch (err: any) {
            setError(err.message || 'Failed to get a response from the assistant.');
        } finally {
            setLoading(false);
        }
    };

    const handleSend = () => {
        sendMessage(input);
    };

    const handleQuickPrompt = (prompt: QuickPrompt) => {
        sendMessage(prompt.text);
    };

    const selectedProfile = responseProfiles[responseProfile];
    const selectedFocusArea = focusAreas.find(area => area.id === selectedFocus)!;

    return (
        <div className="h-full flex flex-col space-y-6">
            <Card className="relative overflow-hidden bg-gradient-to-r from-blue-50 via-purple-50 to-sky-50 border-blue-100 shadow-xl">
                <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-blue-100 blur-3xl" aria-hidden />
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative">
                    <div className="space-y-2">
                        <p className="inline-flex items-center text-sm font-medium tracking-wide uppercase text-blue-600"><Sparkles className="mr-2 h-4 w-4" /> Personalised Parkinson&apos;s Support</p>
                        <h2 className="text-3xl font-bold text-gray-900">AI Care Companion</h2>
                        <p className="text-gray-700 max-w-2xl">Ask focused questions about Parkinson&apos;s wellness, treatment routines, or caregiver planning. Tailor responses for the moment, and let the assistant read them aloud if hearing text is easier.</p>
                    </div>
                    <div className="rounded-xl border border-blue-200 bg-white px-5 py-4 text-sm shadow-lg">
                        <p className="font-semibold mb-1 text-gray-700">Current focus</p>
                        <p className="text-lg font-bold text-blue-600">{selectedFocusArea.label}</p>
                        <p className="text-xs text-gray-600 mt-1">{selectedProfile.label} • {selectedProfile.description}</p>
                    </div>
                </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-semibold text-gray-900">Response style</h3>
                            <p className="text-sm text-gray-600">Shape how detailed the assistant should be.</p>
                        </div>
                        <SlidersHorizontal className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        {Object.entries(responseProfiles).map(([key, profile]) => {
                            const isActive = responseProfile === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setResponseProfile(key as ResponseProfileKey)}
                                    className={`rounded-xl border px-3 py-3 text-left transition ${isActive ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-lg' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
                                >
                                    <p className="font-semibold text-sm">{profile.label}</p>
                                    <p className="text-xs text-gray-600 mt-1">{profile.description}</p>
                                </button>
                            );
                        })}
                    </div>
                </Card>

                <Card>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-semibold text-gray-900">Focus area</h3>
                            <p className="text-sm text-gray-600">Guide the assistant toward what matters now.</p>
                        </div>
                        <Sparkles className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {focusAreas.map(area => {
                            const isActive = selectedFocus === area.id;
                            return (
                                <button
                                    key={area.id}
                                    onClick={() => setSelectedFocus(area.id)}
                                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${isActive ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-md' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
                                >
                                    <p className="font-semibold">{area.label}</p>
                                    <p className="text-xs text-gray-600 mt-1 max-w-[14rem]">{area.description}</p>
                                </button>
                            );
                        })}
                    </div>
                </Card>

                <Card>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-semibold text-gray-900">Accessibility</h3>
                            <p className="text-sm text-gray-600">Enable playback or copy the latest guidance.</p>
                        </div>
                    </div>
                    <div className="mt-4 space-y-3 text-sm">
                        {speechSupported ? (
                            <div className="flex items-center justify-between rounded-lg border border-gray-300 px-3 py-2">
                                <div>
                                    <p className="font-medium text-gray-900">Auto-play responses</p>
                                    <p className="text-xs text-gray-600">Have the assistant read new answers aloud automatically.</p>
                                </div>
                                <button
                                    onClick={() => setAutoSpeak(prev => !prev)}
                                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${autoSpeak ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                >
                                    {autoSpeak ? 'On' : 'Off'}
                                </button>
                            </div>
                        ) : (
                            <p className="rounded-lg border border-gray-300 px-3 py-3 text-gray-600">Text-to-speech is unavailable in this browser.</p>
                        )}
                        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-xs text-gray-700">
                            Tip: You can also copy any response using the clipboard icon next to it.
                        </p>
                    </div>
                </Card>
            </div>

            <Card>
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Suggested prompts</h3>
                        <p className="text-xs text-gray-600">Tap a prompt to ask it instantly.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {sortedPrompts.map(prompt => (
                            <button
                                key={prompt.id}
                                onClick={() => handleQuickPrompt(prompt)}
                                className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm text-left text-gray-700 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                                disabled={loading}
                            >
                                {prompt.label}
                            </button>
                        ))}
                    </div>
                </div>
            </Card>

            <div className="flex-1 bg-white border border-gray-200 rounded-xl flex flex-col p-4 shadow-lg">
                <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Conversation</h3>
                        <p className="text-xs text-gray-600">Responses stay concise by default. Switch styles above for more detail.</p>
                    </div>
                    <div className="text-right text-xs text-gray-600">
                        <p>{selectedProfile.label}</p>
                        <p>{selectedFocusArea.label}</p>
                    </div>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto pr-2">
                    <AnimatePresence>
                    {messages.map((msg) => (
                        <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className={`flex flex-col ${msg.from === 'user' ? 'items-end' : 'items-start'}`}
                        >
                            <div className={`flex items-start space-x-3 ${msg.from === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                                {msg.from === 'bot' ? <Bot className="h-8 w-8 text-blue-600 flex-shrink-0" /> : <User className="h-8 w-8 text-gray-600 flex-shrink-0" />}
                                <div className={`p-3 rounded-2xl shadow-sm max-w-2xl ${msg.from === 'bot' ? 'bg-gray-50 border border-gray-200 text-gray-900' : 'bg-blue-600 text-white border border-blue-700'}`}>
                                    <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                                </div>
                            </div>
                            {msg.from === 'bot' && (
                                <div className="mt-2 flex items-center gap-3 text-xs text-gray-600">
                                    {speechSupported && (
                                        <button
                                            onClick={() => toggleSpeakForMessage(msg)}
                                            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 hover:border-primary/60"
                                        >
                                            {speakingMessageId === msg.id ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                                            {speakingMessageId === msg.id ? 'Stop audio' : 'Play audio'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleCopy(msg)}
                                        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 hover:border-primary/60"
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                        {copiedMessageId === msg.id ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    ))}
                    {loading && (
                         <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-start space-x-3"
                        >
                            <Bot className="h-8 w-8 text-primary-foreground flex-shrink-0" />
                            <div className="p-3 rounded-2xl max-w-2xl bg-muted flex items-center space-x-2 border border-border/60">
                                <LoaderCircle className="animate-spin h-4 w-4" />
                                <span>Preparing a tailored answer…</span>
                            </div>
                        </motion.div>
                    )}
                    </AnimatePresence>
                    <div ref={messagesEndRef} />
                </div>
                {error && (
                    <div className="flex items-center space-x-2 text-red-400 bg-red-900/20 p-3 rounded-lg mt-3">
                        <AlertCircle size={20} />
                        <p className="text-sm">{error}</p>
                    </div>
                )}
                <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
                    <div className="flex items-center space-x-2">
                        <input 
                            type="text" 
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Ask about symptom relief, exercise, medications, or emotional wellbeing..."
                            className="w-full bg-input p-3 rounded-lg border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                            disabled={loading}
                        />
                        <button onClick={handleSend} className="bg-primary text-primary-foreground p-3 rounded-lg disabled:opacity-50" disabled={loading}>
                            <Send />
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">This assistant supports—not replaces—your medical team. For urgent symptoms, contact a healthcare professional immediately.</p>
                </div>
            </div>
        </div>
    );
};

export default Chatbot;
