import { useParams } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import ProfileCard from "@/components/ProfileCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWebSocket } from "@/hooks/useWebSocket";
import { getEventChannel, getUserChannel } from "@/lib/pusher";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/UserAvatar";
import { TypingIndicator } from "@/components/TypingIndicator";

interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
  userReacted: boolean;
}

interface ExtendedMessage {
  id: string;
  challengeId: number;
  userId: string;
  message: string;
  createdAt: string;
  type?: 'system' | 'user';
  systemType?: 'user_join' | 'user_leave' | 'challenge_started' | 'challenge_ended';
  user: {
    id: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    profileImageUrl?: string;
    level?: number;
  };
  reactions?: MessageReaction[];
  replyTo?: {
    id: string;
    message: string;
    user: {
      firstName?: string;
      username?: string;
    };
  };
  mentions?: string[];
}

const COMMON_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

export default function ChallengeChatPage() {
  const params = useParams();
  const challengeId = params.id ? parseInt(params.id) : null;
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newMessage, setNewMessage] = useState("");
  const [typingUsers, setTypingUsers] = useState<{userId: string, name: string}[]>([]);
  const [replyingTo, setReplyingTo] = useState<ExtendedMessage | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'comments' | 'matches' | 'activity'>('comments');
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<ExtendedMessage[]>([]);

  const { data: challenge, isLoading: isChallengeLoading, error: challengeError } = useQuery({
    queryKey: ["/api/challenges", challengeId],
    enabled: !!challengeId,
    retry: false,
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
      }
    },
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ["/api/challenges", challengeId, "messages"],
    enabled: !!challengeId,
    retry: false,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["/api/challenges", challengeId, "participants"],
    enabled: !!challengeId,
    retry: false,
  });

  useEffect(() => {
    if (participants.length > 0 && user) {
      // placeholder for any participant-specific state
    }
  }, [participants, user]);

  useEffect(() => {
    if (!challengeId) return;

    const channel = getEventChannel(challengeId);

    channel.bind('new-message', (data: any) => {
      refetchMessages();
    });

    channel.bind('reaction-update', (data: any) => {
      refetchMessages();
    });

    return () => {
      channel.unbind('new-message');
      channel.unbind('reaction-update');
    };
  }, [challengeId, refetchMessages]);

  const { sendMessage, isConnected } = useWebSocket({
    onMessage: (data) => {
      if (data.type === 'challenge_message' && data.challengeId === challengeId) {
        refetchMessages();
      } else if (data.type === 'user_typing' && data.challengeId === challengeId) {
        if (data.userId && data.userId !== user?.id) {
          setTypingUsers(prev => {
            const filtered = prev.filter(u => u.userId !== data.userId);
            if (data.isTyping) {
              return [...filtered, { userId: data.userId, name: data.username || 'User' }];
            }
            return filtered;
          });

          if (data.isTyping) {
            const timeoutId = setTimeout(() => {
              setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
            }, 5000);
            return () => clearTimeout(timeoutId);
          }
        }
      } else if (data.type === 'message_reaction' && data.challengeId === challengeId) {
        refetchMessages();
      } else if (data.type === 'system_message' && data.challengeId === challengeId) {
        refetchMessages();
      }
    }
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData: { message: string; replyToId?: string; mentions?: string[] }) => {
      return await apiRequest("POST", `/api/challenges/${challengeId}/messages`, messageData);
    },
    onSuccess: (data) => {
      setNewMessage("");
      setReplyingTo(null);
      setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 50);
      refetchMessages();
      if (sendMessage) {
        sendMessage({
          type: 'challenge_message',
          challengeId,
          messageId: data?.id,
          userId: user?.id,
        });
      }
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reactToMessageMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      await apiRequest("POST", `/api/challenges/${challengeId}/messages/${messageId}/react`, { emoji });
    },
    onMutate: async ({ messageId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/challenges", challengeId, "messages"] });
      const previousMessages = queryClient.getQueryData(["/api/challenges", challengeId, "messages"]);
      queryClient.setQueryData(["/api/challenges", challengeId, "messages"], (old: any) => {
        if (!old) return old;
        return old.map((message: any) => {
          if (message.id === messageId) {
            const reactions = message.reactions || [];
            const existingReaction = reactions.find((r: any) => r.emoji === emoji);
            if (existingReaction) {
              if (existingReaction.userReacted) {
                return {
                  ...message,
                  reactions: existingReaction.count === 1 
                    ? reactions.filter((r: any) => r.emoji !== emoji)
                    : reactions.map((r: any) => r.emoji === emoji 
                        ? { ...r, count: r.count - 1, userReacted: false }
                        : r)
                };
              } else {
                return {
                  ...message,
                  reactions: reactions.map((r: any) => r.emoji === emoji 
                    ? { ...r, count: r.count + 1, userReacted: true }
                    : r)
                };
              }
            } else {
              return {
                ...message,
                reactions: [...reactions, { emoji, count: 1, userReacted: true }]
              };
            }
          }
          return message;
        });
      });
      return { previousMessages };
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData(["/api/challenges", challengeId, "messages"], context?.previousMessages);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/challenges", challengeId, "messages"] });
      if (sendMessage) {
        sendMessage({
          type: 'message_reaction',
          challengeId,
          userId: user?.id,
        });
      }
    },
  });

  useEffect(() => {
    setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "instant" });
      }
    }, 100);
  }, []);

  useEffect(() => {
    if (messagesEndRef.current && messages.length > 0) {
      requestAnimationFrame(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
      });
    }
  }, [messages]);

  useEffect(() => {
    if (user && challengeId && sendMessage && isConnected) {
      sendMessage({
        type: 'challenge_user_join',
        challengeId,
        userId: user.id,
        username: user.firstName || user.username || 'User'
      });
    }

    return () => {
      if (user && challengeId && sendMessage) {
        sendMessage({
          type: 'challenge_user_leave',
          challengeId,
          userId: user.id,
          username: user.firstName || user.username || 'User'
        });
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [user, challengeId, sendMessage, isConnected]);

  const handleTyping = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (sendMessage && user?.id && isConnected) {
      try {
        sendMessage({
          type: 'user_typing',
          challengeId,
          userId: user.id,
          username: user.firstName || user.username || 'User',
          isTyping: true,
        });

        typingTimeoutRef.current = setTimeout(() => {
          if (sendMessage && isConnected) {
            try {
              sendMessage({
                type: 'user_typing',
                challengeId,
                userId: user.id,
                username: user.firstName || user.username || 'User',
                isTyping: false,
              });
            } catch (error) {
              console.error('Error sending typing stop message:', error);
            }
          }
        }, 3000);
      } catch (error) {
        console.error('Error sending typing message:', error);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const previousValue = newMessage;
    setNewMessage(value);
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1 && lastAtIndex === value.length - 1) {
      setShowMentions(true);
      setMentionQuery("");
    } else if (lastAtIndex !== -1) {
      const query = value.slice(lastAtIndex + 1);
      if (query.includes(' ')) {
        setShowMentions(false);
      } else {
        setMentionQuery(query);
        setShowMentions(true);
      }
    } else {
      setShowMentions(false);
    }
    if (value.length > previousValue.length && value.trim() !== '') {
      handleTyping();
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (sendMessage && user?.id && isConnected) {
      sendMessage({
        type: 'user_typing',
        challengeId,
        userId: user.id,
        username: user.firstName || user.username || 'User',
        isTyping: false,
      });
    }
    const mentions = extractMentions(newMessage);
    const tempMessage = {
      id: `temp-${Date.now()}`,
      challengeId: challengeId!,
      userId: user!.id,
      message: newMessage,
      createdAt: new Date().toISOString(),
      type: 'user' as const,
      user: {
        id: user!.id,
        firstName: user!.firstName,
        lastName: user!.lastName,
        username: user!.username,
        profileImageUrl: user!.profileImageUrl,
        level: user!.level,
      },
      reactions: [],
      mentions: mentions,
    };
    queryClient.setQueryData(["/api/challenges", challengeId, "messages"], (old: any) => {
      if (!old) return [tempMessage];
      return [...old, tempMessage];
    });
    setTimeout(() => {
      if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, 10);
    sendMessageMutation.mutate({ message: newMessage, replyToId: replyingTo?.id, mentions });
    setNewMessage("");
    setShowMentions(false);
    setMentionQuery("");
    setReplyingTo(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    } else if (e.key === 'Escape') {
      setReplyingTo(null);
      setShowMentions(false);
    }
  };

  const handleReaction = (messageId: string, emoji: string) => {
    reactToMessageMutation.mutate({ messageId, emoji });
  };

  const handleReply = (message: ExtendedMessage) => {
    setReplyingTo(message);
    inputRef.current?.focus();
  };

  const handleMention = (username: string) => {
    const lastAtIndex = newMessage.lastIndexOf('@');
    const beforeAt = newMessage.slice(0, lastAtIndex);
    const afterQuery = newMessage.slice(lastAtIndex + 1 + mentionQuery.length);
    setNewMessage(`${beforeAt}@${username} ${afterQuery}`);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const extractMentions = (text: string): string[] => {
    const mentionRegex = /@(\w+)/g;
    const mentions = [] as string[];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = messages.filter((message: ExtendedMessage) =>
        message.message.toLowerCase().includes(query.toLowerCase()) ||
        (message.user?.firstName || "").toLowerCase().includes(query.toLowerCase()) ||
        (message.user?.username || "").toLowerCase().includes(query.toLowerCase())
      );
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const filteredParticipants = participants.filter((p: any) =>
    (p.user?.username || "").toLowerCase().includes(mentionQuery.toLowerCase()) ||
    (p.user?.firstName || "").toLowerCase().includes(mentionQuery.toLowerCase())
  );

  if (!challengeId) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Challenge Not Found</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-4">The challenge you're looking for doesn't exist.</p>
          <Button onClick={() => window.location.href = '/challenges'}>Back to Challenges</Button>
        </div>
      </div>
    );
  }
  // If challenge metadata is still loading, don't block rendering of the chat UI.
  // Allow users to open the chat page even if the challenge record hasn't been fetched
  // (useful for admin-created or private challenges where the backend may restrict metadata).
  const showLoadingChallenge = isChallengeLoading && messages.length === 0;
  if (showLoadingChallenge) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading challenge...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`nav { display: none !important; }`}</style>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col md:bg-slate-50 md:dark:bg-slate-900">
        <div className="bg-[#7440ff] text-white sticky top-0 z-50 rounded-b-xl md:rounded-none">
          <div className="px-3 md:px-4 py-2 md:py-3">
            <div className="flex items-center justify-between mb-2 md:mb-3">
              <div className="flex items-center space-x-2 md:space-x-3">
                <Button variant="ghost" size="sm" onClick={() => window.location.href = '/challenges'} className="text-white hover:bg-white/20 p-2 rounded-full">
                  <i className="fas fa-arrow-left text-sm"></i>
                </Button>
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 md:w-8 md:h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <i className="fas fa-users text-white text-xs md:text-sm"></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm md:text-base">{challenge?.title || 'Challenge'}</h3>
                    <div className="text-xs text-white/80 leading-tight">
                      <div>#{challenge?.title || 'Challenge'}</div>
                      <div>{participants.length} participants</div>
                      <div>Open menu</div>
                    </div>
                  </div>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 p-0 rounded-full hover:bg-white/20">
                    <span className="sr-only">Open menu</span>
                    <i className="fas fa-ellipsis-v text-white"></i>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-slate-800 border-0 rounded-2xl shadow-xl p-2">
                  <DropdownMenuItem onClick={() => setShowSearch(!showSearch)} className="rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                        <i className="fas fa-search text-blue-600 dark:text-blue-400 text-xs"></i>
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{showSearch ? 'Hide Search' : 'Search'}</span>
                    </div>
                  </DropdownMenuItem>
                  <div className="my-2 h-px bg-slate-200 dark:bg-slate-600"></div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-800 px-2 md:px-3 py-2 md:py-3">
          {/* Tabs: Comments, Matches, Activity */}
          <div className="mb-3">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-2 flex items-center space-x-2">
              <button onClick={() => setActiveTab('comments')} className={`px-3 py-1 rounded-lg text-sm font-medium ${activeTab === 'comments' ? 'bg-primary text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                Comments ({messages.length})
              </button>
              <button onClick={() => setActiveTab('matches')} className={`px-3 py-1 rounded-lg text-sm font-medium ${activeTab === 'matches' ? 'bg-primary text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                Matches
              </button>
              <button onClick={() => setActiveTab('activity')} className={`px-3 py-1 rounded-lg text-sm font-medium ${activeTab === 'activity' ? 'bg-primary text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                Activity
              </button>
            </div>
          </div>

          {/* Tab content */}
          {activeTab === 'comments' && (
            <div className="space-y-1 md:space-y-2">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-slate-500 dark:text-slate-400 py-8">
                    <i className="fas fa-comments text-2xl mb-2"></i>
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message: ExtendedMessage, index: number) => {
                const msgUser = message.user ?? { id: message.userId, username: message.user?.username ?? 'unknown', firstName: '', level: 1 };
                const isSystemMessage = message.type === 'system';
                if (isSystemMessage) {
                  return (
                    <div key={message.id} className="flex justify-center my-3">
                      <div className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full text-xs font-medium">
                        <i className="fas fa-info-circle mr-1"></i>
                        {message.message}
                      </div>
                    </div>
                  );
                }

                const showAvatar = index === messages.length - 1 || messages[index + 1]?.userId !== message.userId;
                const isCurrentUser = message.userId === user?.id;
                const isConsecutive = index < messages.length - 1 && messages[index + 1]?.userId === message.userId;

                return (
                  <div key={message.id} className={`flex space-x-2 ${isCurrentUser ? 'flex-row-reverse space-x-reverse' : ''} ${isConsecutive ? 'mt-1' : 'mt-3'}`}>
                    {!isCurrentUser && showAvatar && (
                      <div className="flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all rounded-full" onClick={() => msgUser.id && setSelectedProfileUserId(msgUser.id)}>
                        <UserAvatar userId={msgUser.id} username={msgUser.username} size={24} className="w-6 h-6" />
                      </div>
                    )}

                    <div className={`flex-1 max-w-[75%] ${isCurrentUser ? 'text-right' : ''} ${!showAvatar && !isCurrentUser ? 'ml-8' : ''}`}>
                      {showAvatar && (
                        <div className={`flex items-center space-x-2 mb-1 ${isCurrentUser ? 'justify-end' : ''}`}>
                          <div className="flex items-center space-x-1">
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{msgUser.firstName || msgUser.username || 'Anonymous'}</span>
                            <div className="bg-blue-500 text-white px-1 py-0.5 rounded-full text-[8px] font-bold leading-none">✓</div>
                            <img src={`/assets/${(msgUser.level || 1) >= 50 ? 'master' : (msgUser.level || 1) >= 30 ? 'expert' : (msgUser.level || 1) >= 20 ? 'advanced' : (msgUser.level || 1) >= 10 ? 'amateur' : 'Beginner'}.svg`} alt={`Level ${msgUser.level || 1}`} className="w-3 h-3" />
                          </div>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</span>
                        </div>
                      )}

                      {message.replyTo && (
                        <div className={`text-xs text-slate-500 dark:text-slate-400 mb-1 ${isCurrentUser ? 'text-right' : ''}`}>
                          <i className="fas fa-reply mr-1"></i>
                          Replying to {message.replyTo.user.firstName || message.replyTo.user.username}
                        </div>
                      )}

                      <div className="group relative">
                        <div className={`inline-block px-3 py-2 rounded-2xl text-sm max-w-full break-words relative ${isCurrentUser ? 'bg-primary text-white' : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100'}`}>
                          {message.replyTo && (
                            <div className={`text-xs opacity-75 mb-1 p-2 rounded border-l-2 ${isCurrentUser ? 'border-white/30 bg-white/10' : 'border-slate-300 bg-slate-50 dark:bg-slate-600'}`}>
                              "{message.replyTo.message.length > 50 ? message.replyTo.message.substring(0, 50) + '...' : message.replyTo.message}"
                            </div>
                          )}
                          <p className="break-words">{message.message}</p>

                          <div className={`absolute top-1/2 -translate-y-1/2 ${isCurrentUser ? '-left-16' : '-right-16'} opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 bg-white dark:bg-slate-800 shadow-lg rounded-lg px-1 py-1 z-10 border`}>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0"><i className="fas fa-smile text-[10px]"></i></Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-2">
                                <div className="flex space-x-1">
                                  {COMMON_REACTIONS.map((emoji) => (
                                    <Button key={emoji} size="sm" variant="ghost" className="h-8 w-8 p-0 text-lg hover:bg-slate-100" onClick={() => handleReaction(message.id, emoji)}>{emoji}</Button>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>

                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => handleReply(message)}>
                              <i className="fas fa-reply text-[10px]"></i>
                            </Button>
                          </div>
                        </div>
                      </div>

                      {message.reactions && message.reactions.length > 0 && (
                        <div className={`flex flex-wrap gap-1 mt-1 ${isCurrentUser ? 'justify-end' : ''}`}>
                          {message.reactions.map((reaction, idx) => (
                            <button key={idx} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md active:scale-95 ${reaction.userReacted ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600'}`} onClick={() => handleReaction(message.id, reaction.emoji)}>
                              <span className="text-xs leading-none">{reaction.emoji}</span>
                              <span className="text-xs leading-none font-semibold">{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
                  })}

                  <TypingIndicator typingUsers={typingUsers.map(u => u.name)} className="px-4 py-2" />
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
          )}

          {activeTab === 'matches' && (
            <div className="space-y-3">
              {participants.length === 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {/* Mock matches when none exist (compact with avatars) */}
                  {[
                    { a: { name: 'Alice', username: 'alice01' }, b: { name: 'Bob', username: 'bob22' }, stake: 50, winner: 'alice01', picked: { a: 'YES', b: 'NO' } },
                    { a: { name: 'Carmen', username: 'carmen' }, b: { name: 'Diego', username: 'diego' }, stake: 30, winner: null, picked: { a: 'NO', b: 'YES' } },
                    { a: { name: 'Eve', username: 'eve' }, b: null, stake: 10, winner: null, picked: { a: 'YES', b: null } },
                  ].map((pair, idx) => (
                    <div key={idx} className="bg-white dark:bg-slate-800 rounded-xl p-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <UserAvatar username={pair.a.username} size={20} className="w-8 h-8" />
                          <div className="text-sm">
                            <div className="font-medium">{pair.a.username}</div>
                            {pair.a.name && <div className="text-xs text-slate-500">{pair.a.name}</div>}
                            {pair.picked?.a && (
                              <div className="mt-1">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${pair.picked.a === 'YES' ? 'bg-green-100 text-green-800' : pair.picked.a === 'NO' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>{pair.picked.a}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-slate-400 px-2">vs</div>
                        {pair.b ? (
                          <div className="flex items-center gap-2">
                            <UserAvatar username={pair.b.username} size={20} className="w-8 h-8" />
                            <div className="text-sm">
                              <div className="font-medium">{pair.b.username}</div>
                              {pair.b.name && <div className="text-xs text-slate-500">{pair.b.name}</div>}
                              {pair.picked?.b && (
                                <div className="mt-1">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${pair.picked.b === 'YES' ? 'bg-green-100 text-green-800' : pair.picked.b === 'NO' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>{pair.picked.b}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-slate-500">Waiting for opponent</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="text-xs text-slate-500">Match #{idx + 1}</div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">Stake {pair.stake}</span>
                          {pair.winner && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Winner</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {(() => {
                    const pairings: Array<[any, any | null]> = [];
                    for (let i = 0; i < participants.length; i += 2) {
                      pairings.push([participants[i], participants[i + 1] || null]);
                    }
                    return pairings.map((pair, idx) => (
                      <div key={idx} className="bg-white dark:bg-slate-800 rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="text-sm">
                            <div className="font-medium">{pair[0]?.user?.username || pair[0]?.user?.firstName || 'Player'}</div>
                          </div>
                          <div className="px-2 text-slate-400">vs</div>
                          {pair[1] ? (
                            <div className="text-sm">
                              <div className="font-medium">{pair[1]?.user?.username || pair[1]?.user?.firstName || 'Player'}</div>
                            </div>
                          ) : (
                            <div className="text-sm text-slate-500">Waiting for opponent</div>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">Match #{idx + 1}</div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-3">
              {(() => {
                const activity = messages.filter((m: ExtendedMessage) => m.type === 'system' || /won|winner|ended|started/i.test(m.message));
                  if (activity.length === 0) {
                  // provide richer mock activity entries for now (no icons/badges)
                  const mockActivity = [
                    { id: 'a1', username: 'alice01', message: 'alice01 defeated bob22 — Winner: alice01', createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString() },
                    { id: 'a2', username: 'system', message: 'Payout of 1000 coins made to alice01', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
                    { id: 'a3', username: 'charlie', message: 'New user joined: charlie', createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString() },
                    { id: 'a4', username: 'system', message: 'New match scheduled: dave vs eva', createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
                    { id: 'a5', username: 'alice01', message: 'alice01 earned 250 points', createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString() },
                    { id: 'a6', username: 'bob22', message: 'bob22 earned a 30-coin bonus', createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString() },
                  ];
                  return (
                    <div className="space-y-2">
                      {mockActivity.map((m: any) => {
                        const isSystem = m.username === 'system';
                        let icon = 'fas fa-bell';
                        const msg = (m.message || '').toLowerCase();
                        if (msg.includes('payout') || msg.includes('coins')) icon = 'fas fa-coins';
                        else if (msg.includes('bonus')) icon = 'fas fa-gift';
                        else if (msg.includes('match')) icon = 'fas fa-flag';
                        else if (msg.includes('tournament') || msg.includes('started')) icon = 'fas fa-trophy';

                        return (
                          <div key={m.id} className="bg-white dark:bg-slate-800 rounded-xl p-2 flex items-start gap-3">
                            {isSystem ? (
                              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200">
                                <i className={`${icon} text-sm`}></i>
                              </div>
                            ) : (
                              <UserAvatar username={m.username} size={20} className="w-8 h-8" />
                            )}
                            <div className="flex-1">
                              <div className="text-sm font-medium">{m.message}</div>
                              <div className="text-xs text-slate-500">{formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {activity.map((m: ExtendedMessage) => (
                      <div key={m.id} className="bg-white dark:bg-slate-800 rounded-xl p-3">
                        <div className="text-sm font-medium">{m.message}</div>
                        <div className="text-xs text-slate-500">{formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {activeTab === 'comments' && showSearch && (
          <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center space-x-2 mb-2">
              <div className="flex-1 relative">
                <Input placeholder="Search messages..." value={searchQuery} onChange={(e) => handleSearch(e.target.value)} className="pr-8" />
                <Button variant="ghost" size="sm" onClick={() => setShowSearch(false)} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 h-6 w-6"><i className="fas fa-times text-xs"></i></Button>
              </div>
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                {searchResults.slice(0, 5).map((message: ExtendedMessage) => (
                  <div key={message.id} className="p-2 bg-slate-50 dark:bg-slate-700 rounded text-sm">
                    <div className="flex items-center space-x-2 mb-1">
                      <UserAvatar userId={message.user.id} username={message.user.username} size={16} className="w-4 h-4" />
                      <span className="font-medium">{message.user.firstName || message.user.username}</span>
                      <span className="text-xs text-slate-500">{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300">{message.message}</p>
                  </div>
                ))}
              </div>
            )}

            {searchQuery && searchResults.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-2">No messages found</p>
            )}
          </div>
        )}

        {activeTab === 'comments' && replyingTo && (
          <div className="bg-slate-200 dark:bg-slate-700 px-4 py-2 border-l-4 border-primary">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <span className="text-xs text-slate-600 dark:text-slate-400">Replying to {replyingTo.user.firstName || replyingTo.user.username}</span>
                <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{replyingTo.message}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setReplyingTo(null)}><i className="fas fa-times text-xs"></i></Button>
            </div>
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 p-2 sticky bottom-0 rounded-t-2xl md:rounded-none mobile-nav-safe-area">
            {!isAuthenticated ? (
              <div className="text-center py-4">
                <div className="bg-gradient-to-r from-primary/10 to-purple-500/10 rounded-xl p-4 mb-3">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Join the conversation!</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">Sign up to participate in this challenge chat</p>
                  <Button onClick={() => window.location.href = '/api/login'} className="bg-primary text-white hover:bg-primary/90 px-6 py-2 rounded-full font-medium">Sign Up / Login</Button>
                </div>
              </div>
            ) : (
              <div className="relative">
                {showMentions && filteredParticipants.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-t-xl shadow-lg max-h-40 overflow-y-auto z-10">
                    {filteredParticipants.slice(0, 5).map((participant: any) => (
                      <div key={participant.user.id} className="px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer flex items-center space-x-2" onClick={() => handleMention(participant.user.username || participant.user.firstName)}>
                        <UserAvatar userId={participant.user.id} username={participant.user.username} size={20} className="w-5 h-5" />
                        <span className="text-sm">{participant.user.firstName || participant.user.username}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10 p-2 rounded-full"><i className="fas fa-smile text-base md:text-lg"></i></Button>
                  <div className="flex-1 relative">
                    <Input ref={inputRef} type="text" placeholder="Type a message..." value={newMessage} onChange={handleInputChange} onKeyDown={handleKeyPress} className="bg-slate-100 dark:bg-slate-700 border-none rounded-full pl-4 pr-4 py-2 text-sm" disabled={false} />
                    {!isConnected && (<div className="absolute right-3 top-1/2 transform -translate-y-1/2"><div className="w-2 h-2 bg-red-500 rounded-full"></div></div>)}
                  </div>
                  <Button onClick={handleSendMessage} disabled={!newMessage.trim() || sendMessageMutation.isPending} className="bg-primary text-white hover:bg-primary/90 rounded-full p-2 active:scale-95"><i className="fas fa-paper-plane text-sm"></i></Button>
                </div>
              </div>
            )}
          </div>
        )}

        {selectedProfileUserId && (<ProfileCard userId={selectedProfileUserId} onClose={() => setSelectedProfileUserId(null)} />)}
      </div>
    </>
  );
}
