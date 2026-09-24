import React from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  Warning,
  CheckCircle,
  Clock,
  Storefront,
  Users,
  Plus,
  Check,
  ChartBar,
  ThumbsUp,
  Tag,
  ChatCircleText,
  Buildings,
  TrendUp,
  MagnifyingGlass,
  CaretDown,
  ThumbsDown,
  MapPin,
  Lightning,
  Lightbulb,
  PencilSimple,
  ArrowUpRight,
  ArrowDownRight,
  X,
  Crosshair,
  Smiley,
  Phone,
  DownloadSimple,
  Bell,
  Trash,
  ShieldCheck,
  Gear,
  PaperPlaneRight,
  ArrowClockwise,
  ArrowSquareOut,
  CaretRight,
  QrCode,
  DotsThreeVertical,
  MapTrifold,
  SignOut,
  LockSimple,
  SquaresFour,
  Bank,
  Key,
  Funnel,
  FileText,
  Copy,
  EnvelopeSimple,
  ArrowLeft,
  ListBullets,
} from '@phosphor-icons/react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  color?: string;
  /** Conservé pour compatibilité d'API : sans effet sur Phosphor (poids "regular" fixe partout, cf. décision validée). */
  strokeWidth?: number;
}

// Icônes Phosphor (@phosphor-icons/react), poids "regular" uniforme sur tout le
// dashboard. Chaque export ci-dessous garde le NOM et l'API (size/color) des
// anciennes icônes faites main, pour que les ~150 appelants du dashboard n'aient
// rien à changer — seul l'intérieur de ce fichier a été remplacé.
//
// `wrap` fixe le poids à "regular" et la couleur par défaut à 'currentColor' ;
// `size` par défaut reproduit celui de chaque icône d'origine (voir commentaire
// par export) pour ne rien redimensionner là où `size` n'est pas passé explicitement.
function wrap(PhosphorComponent: PhosphorIcon, defaultSize: number): React.FC<IconProps> {
  return function WrappedIcon({ size = defaultSize, color = 'currentColor', strokeWidth, ...props }) {
    return <PhosphorComponent size={size} color={color} weight="regular" {...props} />;
  };
}

export const LayoutGridIcon = wrap(SquaresFour, 20);
export const BarChartIcon = wrap(ChartBar, 20);
export const BuildingIcon = wrap(Buildings, 20);
export const StoreIcon = wrap(Storefront, 20);
export const UsersIcon = wrap(Users, 20);
export const SettingsIcon = wrap(Gear, 20);
export const MessageSquareIcon = wrap(ChatCircleText, 20);
export const BellIcon = wrap(Bell, 20);
export const LightbulbIcon = wrap(Lightbulb, 20);
export const TrendingUpIcon = wrap(TrendUp, 20);
export const LogOutIcon = wrap(SignOut, 20);
export const LandmarkIcon = wrap(Bank, 20);
export const ShieldCheckIcon = wrap(ShieldCheck, 20);
export const SearchIcon = wrap(MagnifyingGlass, 20);
export const ChevronDownIcon = wrap(CaretDown, 20);
export const ChevronRightIcon = wrap(CaretRight, 20);
export const PlusIcon = wrap(Plus, 20);
export const ArrowUpRightIcon = wrap(ArrowUpRight, 14);
export const ArrowDownRightIcon = wrap(ArrowDownRight, 14);
export const ClockIcon = wrap(Clock, 16);
export const DownloadIcon = wrap(DownloadSimple, 16);
export const LightningIcon = wrap(Lightning, 16);
export const AlertTriangleIcon = wrap(Warning, 20);
export const CheckCircleIcon = wrap(CheckCircle, 20);
export const MapPinIcon = wrap(MapPin, 20);
export const MapIcon = wrap(MapTrifold, 20);
export const XCloseIcon = wrap(X, 20);
export const CheckIcon = wrap(Check, 20);
export const EditIcon = wrap(PencilSimple, 18);
export const TrashIcon = wrap(Trash, 18);
export const QrCodeIcon = wrap(QrCode, 20);
export const CopyIcon = wrap(Copy, 16);
export const MailIcon = wrap(EnvelopeSimple, 18);
export const ArrowLeftIcon = wrap(ArrowLeft, 16);
export const ActivityIcon = wrap(ListBullets, 18);
export const TargetIcon = wrap(Crosshair, 18);
export const PhoneIcon = wrap(Phone, 18);
export const ThumbsUpIcon = wrap(ThumbsUp, 18);
export const ThumbsDownIcon = wrap(ThumbsDown, 18);
export const FilterIcon = wrap(Funnel, 18);
export const ExternalLinkIcon = wrap(ArrowSquareOut, 16);
export const FileTextIcon = wrap(FileText, 18);
export const TagIcon = wrap(Tag, 18);
export const LockIcon = wrap(LockSimple, 18);
export const SmileIcon = wrap(Smiley, 20);
export const KeyIcon = wrap(Key, 18);
export const MoreVerticalIcon = wrap(DotsThreeVertical, 18);
export const SendIcon = wrap(PaperPlaneRight, 18);

// RefreshIcon / RefreshCwIcon : deux icônes distinctes à l'origine (toutes deux
// une flèche circulaire « réessayer/rouvrir »), fusionnées en une seule
// implémentation Phosphor (ArrowClockwise) — décision validée après vérification
// des 2 appelants (FeedbackTreatmentModal "Rouvrir", StatsStates "Réessayer" :
// même sens). Les deux noms restent exportés pour ne rien casser côté appelants.
export const RefreshIcon = wrap(ArrowClockwise, 18);
export const RefreshCwIcon = wrap(ArrowClockwise, 16);

// Sparkline SVG Graphique pour le coin supérieur des cartes — hors périmètre du
// remplacement Phosphor (pas une icône, un mini-graphique dessiné à la main).
export const SparklineWave: React.FC<{ type?: 'up' | 'down' | 'neutral'; color?: string; width?: number; height?: number }> = ({
  type = 'up',
  color,
  width = 64,
  height = 24,
}) => {
  const strokeColor = color || (type === 'up' ? '#3C7730' : type === 'down' ? '#DC2626' : '#94A3B8');

  return (
    <svg width={width} height={height} viewBox="0 0 64 24" fill="none">
      {type === 'up' ? (
        <path
          d="M2 18L14 14L26 19L38 9L50 14L62 4"
          stroke={strokeColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : type === 'down' ? (
        <path
          d="M2 6L14 12L26 7L38 17L50 11L62 20"
          stroke={strokeColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M2 14L14 10L26 15L38 12L50 8L62 11"
          stroke={strokeColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
};
