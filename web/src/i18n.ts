import { useSession } from './session';

export type Lang = 'en' | 'te' | 'hi';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'hi', label: 'हिन्दी' },
];

/** Screen words. Keys are the English text, so a missing translation still reads fine. */
const DICT: Record<Exclude<Lang, 'en'>, Record<string, string>> = {
  te: {
    'Auto-print KOTs': 'KOT ఆటో-ప్రింట్', 'Show ready': 'సిద్ధమైనవి చూపు', 'Start all': 'అన్నీ మొదలుపెట్టు', 'To cook now (all tables)': 'ఇప్పుడు వండాల్సినవి (అన్ని టేబుల్స్)', 'Recently cleaned': 'ఇటీవల శుభ్రం చేసినవి', 'Request cleaning': 'శుభ్రం చేయమని అడగండి', 'Address': 'చిరునామా', 'All items': 'అన్ని ఐటమ్స్', 'Amount due': 'చెల్లించాల్సిన మొత్తం', 'Back to tables': 'టేబుల్స్\u200cకు వెనక్కి', 'Bill no.': 'బిల్ నం.', 'Cancel order': 'ఆర్డర్ రద్దు', 'Cash received (optional)': 'తీసుకున్న నగదు (ఐచ్ఛికం)', 'Clear': 'తీసివేయి', 'Customer mobile number': 'కస్టమర్ మొబైల్ నంబర్', 'Customer name': 'కస్టమర్ పేరు', 'Discount': 'డిస్కౌంట్', 'Grand total': 'మొత్తం', 'Guests': 'అతిథులు', 'Items': 'ఐటమ్స్', 'KOT & Print': 'KOT & ప్రింట్', 'Mark served': 'వడ్డించాము', 'Mobile number': 'మొబైల్ నంబర్', 'Move table': 'టేబుల్ మార్చు', 'New (not sent)': 'కొత్తవి (పంపలేదు)', 'No free tables.': 'ఖాళీ టేబుల్స్ లేవు.', 'No items match.': 'ఐటమ్స్ దొరకలేదు.', 'Open WhatsApp': 'WhatsApp తెరవండి', 'Payment received': 'డబ్బు అందింది', 'Print bill now': 'ఇప్పుడే బిల్ ప్రింట్', 'Reopen': 'మళ్ళీ తెరువు', 'Return change': 'చిల్లర ఇవ్వండి', 'Round off': 'రౌండ్ ఆఫ్', 'Service charge': 'సర్వీస్ ఛార్జ్', 'Sold out': 'అయిపోయింది', 'Sub total': 'ఉప మొత్తం', 'Tap menu items to add them.': 'జోడించడానికి మెనూ ఐటమ్స్\u200cను నొక్కండి.', 'Taxes': 'పన్నులు', 'Total': 'మొత్తం', 'WhatsApp': 'WhatsApp', 'Guest requests': 'అతిథుల అభ్యర్థనలు', 'Nothing waiting.': 'ఏమీ పెండింగ్ లేదు.', 'From the QR code on each table': 'ప్రతి టేబుల్\u200cపై QR కోడ్ నుండి',
    Tables: 'టేబుల్స్', Kitchen: 'కిచెన్', Bills: 'బిల్లులు', Requests: 'అభ్యర్థనలు', Cleaning: 'శుభ్రత', Reports: 'రిపోర్టులు',
    Menu: 'మెనూ', 'Floor plan': 'ఫ్లోర్ ప్లాన్', Staff: 'సిబ్బంది', Permissions: 'అనుమతులు', Settings: 'సెట్టింగులు', Activity: 'కార్యకలాపాలు',
    Licences: 'లైసెన్సులు', Help: 'సహాయం', More: 'మరిన్ని', 'Log out': 'లాగ్ అవుట్',
    Free: 'ఖాళీ', Seated: 'కూర్చున్నారు', Eating: 'తింటున్నారు', Cooking: 'వండుతున్నారు', 'Food ready': 'ఆహారం సిద్ధం',
    'Bill please': 'బిల్లు ఇవ్వండి', 'Collect payment': 'డబ్బు తీసుకోండి', 'Needs cleaning': 'శుభ్రం చేయాలి',
    Parcel: 'పార్సెల్', Delivery: 'డెలివరీ', 'Parcel & delivery': 'పార్సెల్ & డెలివరీ', seats: 'సీట్లు',
    'Bill no. / phone': 'బిల్ నం. / ఫోన్', 'Send to kitchen': 'కిచెన్‌కు పంపండి', 'Dining complete': 'భోజనం పూర్తి',
    'Close table & bill': 'టేబుల్ మూసి బిల్', Settle: 'చెల్లింపు', Save: 'సేవ్', Cancel: 'రద్దు', Back: 'వెనక్కి',
    'All ready': 'అన్నీ సిద్ధం', Ready: 'సిద్ధం', Done: 'అయిపోయింది', Print: 'ప్రింట్', Language: 'భాష',
    'Call support': 'సపోర్ట్‌కు కాల్', 'Need help?': 'సహాయం కావాలా?', Today: 'ఈరోజు', Week: 'వారం', Month: 'నెల', Custom: 'మీకు నచ్చిన తేదీలు',
    Download: 'డౌన్‌లోడ్', 'Net sales': 'నికర అమ్మకాలు', Loading: 'లోడ్ అవుతోంది',
  },
  hi: {
    'Auto-print KOTs': 'KOT ऑटो-प्रिंट', 'Show ready': 'तैयार दिखाएँ', 'Start all': 'सब शुरू करें', 'To cook now (all tables)': 'अभी बनाना है (सभी टेबल)', 'Recently cleaned': 'हाल ही में साफ़ किए', 'Request cleaning': 'सफ़ाई के लिए कहें', 'Address': 'पता', 'All items': 'सभी आइटम', 'Amount due': 'बकाया राशि', 'Back to tables': 'टेबल पर वापस', 'Bill no.': 'बिल नं.', 'Cancel order': 'ऑर्डर रद्द', 'Cash received (optional)': 'मिला नकद (वैकल्पिक)', 'Clear': 'साफ़ करें', 'Customer mobile number': 'ग्राहक का मोबाइल नंबर', 'Customer name': 'ग्राहक का नाम', 'Discount': 'छूट', 'Grand total': 'कुल योग', 'Guests': 'मेहमान', 'Items': 'आइटम', 'KOT & Print': 'KOT और प्रिंट', 'Mark served': 'परोस दिया', 'Mobile number': 'मोबाइल नंबर', 'Move table': 'टेबल बदलें', 'New (not sent)': 'नए (भेजे नहीं)', 'No free tables.': 'कोई खाली टेबल नहीं।', 'No items match.': 'कोई आइटम नहीं मिला।', 'Open WhatsApp': 'WhatsApp खोलें', 'Payment received': 'भुगतान मिल गया', 'Print bill now': 'अभी बिल प्रिंट करें', 'Reopen': 'फिर से खोलें', 'Return change': 'छुट्टा लौटाएँ', 'Round off': 'राउंड ऑफ़', 'Service charge': 'सर्विस चार्ज', 'Sold out': 'ख़त्म', 'Sub total': 'उप योग', 'Tap menu items to add them.': 'जोड़ने के लिए मेन्यू आइटम दबाएँ।', 'Taxes': 'टैक्स', 'Total': 'कुल', 'WhatsApp': 'WhatsApp', 'Guest requests': 'मेहमानों के अनुरोध', 'Nothing waiting.': 'कुछ भी बाकी नहीं।', 'From the QR code on each table': 'हर टेबल के QR कोड से',
    Tables: 'टेबल', Kitchen: 'किचन', Bills: 'बिल', Requests: 'अनुरोध', Cleaning: 'सफ़ाई', Reports: 'रिपोर्ट',
    Menu: 'मेन्यू', 'Floor plan': 'फ़्लोर प्लान', Staff: 'स्टाफ़', Permissions: 'अनुमतियाँ', Settings: 'सेटिंग्स', Activity: 'गतिविधि',
    Licences: 'लाइसेंस', Help: 'मदद', More: 'और', 'Log out': 'लॉग आउट',
    Free: 'खाली', Seated: 'बैठे हैं', Eating: 'खा रहे हैं', Cooking: 'बन रहा है', 'Food ready': 'खाना तैयार',
    'Bill please': 'बिल दीजिए', 'Collect payment': 'पैसे लीजिए', 'Needs cleaning': 'सफ़ाई चाहिए',
    Parcel: 'पार्सल', Delivery: 'डिलीवरी', 'Parcel & delivery': 'पार्सल और डिलीवरी', seats: 'सीटें',
    'Bill no. / phone': 'बिल नं. / फ़ोन', 'Send to kitchen': 'किचन भेजें', 'Dining complete': 'खाना पूरा',
    'Close table & bill': 'टेबल बंद करें और बिल', Settle: 'भुगतान', Save: 'सेव', Cancel: 'रद्द', Back: 'वापस',
    'All ready': 'सब तैयार', Ready: 'तैयार', Done: 'हो गया', Print: 'प्रिंट', Language: 'भाषा',
    'Call support': 'सपोर्ट को कॉल', 'Need help?': 'मदद चाहिए?', Today: 'आज', Week: 'सप्ताह', Month: 'महीना', Custom: 'अपनी तारीखें',
    Download: 'डाउनलोड', 'Net sales': 'कुल बिक्री', Loading: 'लोड हो रहा है',
  },
};

export function translate(lang: string | undefined, text: string): string {
  if (!lang || lang === 'en') return text;
  return DICT[lang as Exclude<Lang, 'en'>]?.[text] ?? text;
}

/** t('Tables') in the signed-in person's language. */
export function useT() {
  const { me } = useSession();
  const lang = me?.user.lang || me?.restaurant.settings.language || 'en';
  return (text: string) => translate(lang, text);
}

/**
 * Table colours people already know from traffic lights:
 * green = free, yellow = cooking, orange = serve now, red = bill, pink = money due, grey = cleaning.
 */
export const STATE_STYLE = {
  free: { label: 'Free', emoji: '🟢' },
  seated: { label: 'Seated', emoji: '🪑' },
  running: { label: 'Eating', emoji: '🍽️' },
  cooking: { label: 'Cooking', emoji: '🍳' },
  ready: { label: 'Food ready', emoji: '🔔' },
  dining_done: { label: 'Bill please', emoji: '🧾' },
  billed: { label: 'Collect payment', emoji: '💰' },
  cleaning: { label: 'Needs cleaning', emoji: '🧹' },
} as const;

/** <T>Send to kitchen</T> renders the text in the user's language. */
export function T({ children }: { children: string }) {
  return translate(useLangCode(), children);
}
function useLangCode() {
  const { me } = useSession();
  return me?.user.lang || me?.restaurant.settings.language || 'en';
}
