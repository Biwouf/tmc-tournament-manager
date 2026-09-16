// Ordre croissant partagé par le back-office et la PWA.
export const TENNIS_RANKINGS = ['NC','40','30/5','30/4','30/3','30/2','30/1','30','15/5','15/4','15/3','15/2','15/1','15','5/6','4/6','3/6','2/6','1/6','0','-2/6','-4/6','-15'] as const;
export type TennisRanking = (typeof TENNIS_RANKINGS)[number];
