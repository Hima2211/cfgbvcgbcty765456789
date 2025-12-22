import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { SocialMediaShare } from "@/components/SocialMediaShare";
import { MessageCircle, Check, X, Eye, Trophy, Share2, Zap, Lock } from "lucide-react";
import { CompactShareButton } from '@/components/ShareButton';
import { shareChallenge } from '@/utils/sharing';
import { UserAvatar } from "@/components/UserAvatar";
import { getAvatarUrl } from "@/utils/avatarUtils";

// Simple category -> emoji/icon mapping
function CategoryIcon({ category }: { category?: string }) {
  const map: Record<string, string> = {
    general: '📌',
    test: '🧪',
    sports: '⚽',
    politics: '🏛️',
    finance: '💰',
    entertainment: '🎬',
  };

  const icon = (category && map[category.toLowerCase()]) || '📢';
  return <span aria-hidden className="text-sm">{icon}</span>;
}

interface ChallengeCardProps {
  challenge: {
    id: number;
    challenger: string;
    challenged: string;
    title: string;
    description?: string;
    category: string;
    amount: string;
    status: string;
    dueDate?: string;
    createdAt: string;
    adminCreated?: boolean;
    bonusSide?: string;
    bonusMultiplier?: string;
    bonusEndsAt?: string;
    bonusAmount?: number; // Custom bonus amount in naira
    yesStakeTotal?: number;
    noStakeTotal?: number;
    coverImageUrl?: string;
    challengerUser?: {
      id: string;
      firstName?: string;
      lastName?: string;
      username?: string;
      profileImageUrl?: string;
    };
    challengedUser?: {
      id: string;
      firstName?: string;
      lastName?: string;
      username?: string;
      profileImageUrl?: string;
    };
  };
  onChatClick?: (challenge: any) => void;
}

export function ChallengeCard({ challenge, onChatClick }: ChallengeCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Check if bonus is active
  const isBonusActive = challenge.bonusEndsAt && new Date(challenge.bonusEndsAt) > new Date();
  
  // Helper to get bonus badge - visible to all users (public display)
  const getBonusBadge = () => {
    if (!isBonusActive || !challenge.bonusSide) return null;
    
    return {
      side: challenge.bonusSide,
      multiplier: challenge.bonusMultiplier || '1.5x',
      amount: challenge.bonusAmount || 0,
      daysLeft: challenge.bonusEndsAt ? 
        Math.ceil((new Date(challenge.bonusEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0
    };
  };

  // Generate sharing data for the challenge
  const challengeShareData = shareChallenge(
    challenge.id.toString(), 
    challenge.title, 
    challenge.amount
  );

  const acceptChallengeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/challenges/${challenge.id}/accept`);
    },
    onSuccess: () => {
      toast({
        title: "Challenge Accepted",
        description: "You have successfully accepted the challenge!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const declineChallengeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('PATCH', `/api/challenges/${challenge.id}`, {
        status: 'cancelled'
      });
    },
    onSuccess: () => {
      toast({
        title: "Challenge Declined",
        description: "You have declined the challenge.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">Pending</Badge>;
      case 'active':
        return <Badge className="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">Active</Badge>;
      case 'completed':
        return <Badge className="bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">Completed</Badge>;
      case 'disputed':
        return <Badge className="bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300">Disputed</Badge>;
      case 'cancelled':
        return <Badge className="bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // Check if current user is a participant in this challenge
  const isMyChallenge = user?.id === challenge.challenger || user?.id === challenge.challenged;

  // Display challenger vs challenged format for all challenges
  // For admin-created open challenges with no users, show "Open Challenge"
  const isOpenAdminChallenge = challenge.adminCreated && challenge.status === 'open' && !challenge.challenger && !challenge.challenged;
  
  const challengerName = challenge.challengerUser?.firstName || challenge.challengerUser?.username || 'Unknown User';
  const challengedName = challenge.challengedUser?.firstName || challenge.challengedUser?.username || 'Unknown User';
  const displayName = isOpenAdminChallenge ? challenge.title : `${challengerName} vs ${challengedName}`;

  // For avatar, show the other user (opponent) if current user is involved, otherwise show challenger
  const otherUser = user?.id === challenge.challenger 
    ? challenge.challengedUser 
    : user?.id === challenge.challenged 
    ? challenge.challengerUser 
    : challenge.challengerUser;
  const timeAgo = formatDistanceToNow(new Date(challenge.createdAt), { addSuffix: true });

  // Helper function to get status text for the card
  const getStatusText = () => {
    switch (challenge.status) {
      case 'pending':
        return 'Waiting for your response';
      case 'active':
        return 'Challenge in progress';
      case 'completed':
        return 'Challenge concluded';
      case 'disputed':
        return 'Challenge disputed';
      case 'cancelled':
        return 'Challenge cancelled';
      default:
        return challenge.status;
    }
  };

  // Helper function for compact time format
  const getCompactTimeAgo = (date: string) => {
    const now = new Date();
    const created = new Date(date);
    const diffMs = now.getTime() - created.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks}w`;
  };

  // Amounts and potential win (include admin bonusMultiplier if present)
  const amountNum = parseFloat(String(challenge.amount)) || 0;
  const bonusMul = parseFloat(String(challenge.bonusMultiplier || '1.00')) || 1;
  // Total pool is both users' stakes combined
  const totalPool = amountNum * 2;
  const potentialWin = Math.round(totalPool * bonusMul);

  const cardClickProps = isOpenAdminChallenge && onChatClick ? { onClick: () => onChatClick({ ...challenge, amount: String(challenge.amount) }), style: { cursor: 'pointer' } as any } : {};

  return (
    <Card className="border border-slate-200 dark:border-slate-600 theme-transition h-full overflow-hidden" {...cardClickProps}>
      <CardContent className="p-3 md:p-4 flex flex-col h-full">
        <div className="flex items-start justify-between gap-2 mb-2 md:mb-3 min-h-[48px]">
          <div className="flex items-start space-x-2 md:space-x-3 min-w-0 flex-1">
            {/* User avatars or open icon */}
            {isOpenAdminChallenge ? (
              <div className="flex items-center flex-shrink-0">
                {/* Cover image replaces platform logo, or show Bantah logo if no image */}
                {challenge.coverImageUrl ? (
                  <img 
                    src={challenge.coverImageUrl} 
                    alt="challenge cover"
                    className="w-10 h-10 md:w-12 md:h-12 rounded-md object-cover"
                  />
                ) : (
                  <img src="/assets/bantahblue.svg" alt="platform" className="w-10 h-10 md:w-12 md:h-12" />
                )}
              </div>
            ) : (
              <div className="flex items-center -space-x-2 flex-shrink-0">
                <Avatar className="w-7 h-7 md:w-8 md:h-8 border-2 border-white dark:border-slate-800 z-10">
                  <AvatarImage 
                    src={challenge.challengerUser?.profileImageUrl || getAvatarUrl(challenge.challengerUser?.id || '', challenge.challengerUser?.username || challengerName)} 
                    alt={challengerName} 
                  />
                  <AvatarFallback className="text-xs font-medium bg-blue-100 text-blue-700">
                    {challengerName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <Avatar className="w-7 h-7 md:w-8 md:h-8 border-2 border-white dark:border-slate-800">
                  <AvatarImage 
                    src={challenge.challengedUser?.profileImageUrl || getAvatarUrl(challenge.challengedUser?.id || '', challenge.challengedUser?.username || challengedName)} 
                    alt={challengedName} 
                  />
                  <AvatarFallback className="text-xs font-medium bg-green-100 text-green-700">
                    {challengedName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-sm md:text-base text-slate-900 dark:text-slate-100 line-clamp-2">{displayName}</h4>
              <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{challenge.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isMyChallenge && <Badge className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs">You</Badge>}
            {getStatusBadge(challenge.status)}
            {challenge.status === 'open' && (
              <div onClick={(e) => e.stopPropagation()}>
                <CompactShareButton 
                  shareData={challengeShareData.shareData}
                  className="text-primary hover:text-primary/80 h-5 w-5"
                />
              </div>
            )}
          </div>
        </div>

        {challenge.description && (
          <div className="flex-1 mb-2 md:mb-3 min-h-[44px] max-h-[44px] overflow-hidden">
            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{challenge.description}</p>
          </div>
        )}

        {/* Bonus Indicator */}
        {isBonusActive && getBonusBadge() && (
          <div className="mb-2 md:mb-3 p-2 md:p-3 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <span className="text-xs md:text-sm font-semibold text-orange-700 dark:text-orange-300">
                  Bonus: {getBonusBadge()?.multiplier} ({getBonusBadge()?.amount ? `₦${getBonusBadge()?.amount.toLocaleString()}` : '0'}) on {getBonusBadge()?.side} side
                </span>
              </div>
              <Badge variant="outline" className="text-xs bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900 dark:text-orange-300 dark:border-orange-700">
                {getBonusBadge()?.daysLeft}d left
              </Badge>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <Badge className="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
              <span className="text-xs font-semibold">Stake: ₦{amountNum.toLocaleString()}</span>
            </Badge>
            <Badge className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
              <span className="text-xs font-semibold">Pool: ₦{totalPool.toLocaleString()}{bonusMul > 1 ? ` (${bonusMul}× bonus)` : ''}</span>
            </Badge>
          </div>
              <div className="flex items-center space-x-1 text-[11px] text-slate-600 dark:text-slate-400">
              {/* Category icon + label */}
              <span className="capitalize flex items-center gap-1">
                <CategoryIcon category={challenge.category} />
                <span>{challenge.category}</span>
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-500 dark:text-slate-400">
                {getCompactTimeAgo(challenge.createdAt)}
              </span>
            </div>
        </div>

          <div className="flex items-center justify-between mt-4">
            <div className="flex space-x-1 items-center">
              {challenge.status === 'pending' && user?.id === challenge.challenged && (
              <>
                <Button
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700 h-6 px-2 text-xs"
                  onClick={(e) => { e.stopPropagation(); acceptChallengeMutation.mutate(); }}
                  disabled={acceptChallengeMutation.isPending}
                >
                  <Check className="w-3 h-3 mr-1" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={(e) => { e.stopPropagation(); declineChallengeMutation.mutate(); }}
                  disabled={declineChallengeMutation.isPending}
                >
                  <X className="w-3 h-3 mr-1" />
                  Decline
                </Button>
              </>
            )}
            {challenge.status === 'pending' && user?.id === challenge.challenger && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); declineChallengeMutation.mutate(); }}
                disabled={declineChallengeMutation.isPending}
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
            )}
            {(challenge.status === 'active' || challenge.status === 'pending') && onChatClick && (
              <Button 
                size="sm" 
                variant="outline"
                className="border-blue-500 text-blue-600 hover:bg-blue-50 h-6 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); onChatClick({ ...challenge, amount: String(challenge.amount) }); }}
              >
                <MessageCircle className="w-3 h-3 mr-1" />
                Chat
              </Button>
            )}
            {challenge.status === 'open' && onChatClick && (
              <Button 
                size="sm" 
                className="bg-primary text-white hover:bg-primary/90 h-6 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); onChatClick({ ...challenge, amount: String(challenge.amount) }); }}
              >
                <Eye className="w-3 h-3 mr-1" />
                Join
              </Button>
            )}
            {challenge.status === 'active' && !onChatClick && (
              <Button size="sm" className="bg-primary text-white hover:bg-primary/90 h-6 px-2 text-xs">
                <Eye className="w-3 h-3 mr-1" />
                View
              </Button>
            )}
            {challenge.status === 'completed' && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
                <Trophy className="w-3 h-3 mr-1" />
                Results
              </Button>
            )}
            </div>
          </div>
      </CardContent>
    </Card>
  );
}