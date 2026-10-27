// Templates written by Hopvote, one per common use, in English and French. They live in the code, not in Community's
// database: the Community page lists them first, signed Hopvote, and the builder opens one from /app/new?template=<id>.
// Each keeps to 5 questions. Kept free of runtime imports: scripts/community-test.mjs
// loads this file with Node to save every template through the real API.
import type { Stored } from "./questions";
import type { Category } from "./templates";

export type OfficialTemplate = { id: string; use: string; lang: "en" | "fr"; category: Category; title: string; description: string; questions: Stored[] };

// Shorthands for each kind of question, as the builder stores it.
export const Q = {
  choice: (question: string, options: string[], multi = false): Stored => ({ type: "choice", question, options, ...(multi ? { multi: true } : {}) }),
  quiz: (question: string, options: string[], correct: number, timer = 20): Stored => ({ type: "choice", question, options, correct, timer }),
  words: (question: string): Stored => ({ type: "words", question, options: [] }),
  open: (question: string): Stored => ({ type: "open", question, options: [] }),
  qa: (question: string): Stored => ({ type: "qa", question, options: [] }),
  scale: (question: string, labels: [string, string], max = 5): Stored => ({ type: "scale", question, options: [], max, labels }),
  scales: (question: string, statements: string[], labels: [string, string], max = 5): Stored => ({ type: "scales", question, options: statements, max, labels }),
  rank: (question: string, options: string[]): Stored => ({ type: "rank", question, options }),
  // The items in the right order: phones get them shuffled.
  order: (question: string, options: string[], timer = 30): Stored => ({ type: "rank", question, options, ordered: true, timer }),
  points: (question: string, options: string[]): Stored => ({ type: "points", question, options }),
  number: (question: string, answer?: number, timer = 30): Stored => (answer === undefined ? { type: "number", question, options: [] } : { type: "number", question, options: [], answer, timer }),
  // Answers between brackets; people place them among the extra words.
  fill: (question: string, fill: string, decoys: string[] = [], timer = 30): Stored => ({ type: "fill", question, options: [], fill, fillMode: "words", ...(decoys.length ? { decoys } : {}), timer }),
  match: (question: string, pairs: [string, string][], timer = 45): Stored => ({ type: "match", question, options: [...pairs.map((p) => p[0]), ...pairs.map((p) => p[1])], timer }),
  // No entries: it spins among the first names of the people connected.
  wheel: (question: string, entries: string[] = []): Stored => ({ type: "wheel", question, options: entries }),
  countdown: (question: string, seconds: number): Stored => ({ type: "countdown", question, options: [], duration: seconds }),
  slide: (question: string, text: string): Stored => ({ type: "slide", question, options: [], text }),
  link: (question: string, url: string): Stored => ({ type: "link", question, options: [], url }),
  contact: (question: string, fields: ("name" | "email" | "phone" | "company")[]): Stored => ({ type: "contact", question, options: [], fields }),
  // Topic rounds (src/rounds.ts): the wheel or the room's vote picks the next topic among `topics`, `rounds` of them are
  // played; each topic's questions follow, in the order of the topics, marked with their topic.
  rounds: (question: string, how: "wheel" | "vote", topics: string[], rounds?: number): Stored => ({ type: how === "vote" ? "choice" : "wheel", question, options: topics, topics: true, ...(rounds ? { rounds } : {}) }),
  inTopic: (topic: number, q: Stored): Stored => ({ ...q, topic }),
};

// A quiz or a wheel spinning among first names: the presentation asks for first names.
export const needsNames = (questions: Stored[]) => questions.some((q) => (q.type === "choice" || q.type === undefined) && typeof q.correct === "number") || questions.some((q) => q.type === "wheel" && !q.options.length);

const t = (id: string, lang: "en" | "fr", category: Category, title: string, description: string, questions: Stored[]): OfficialTemplate => ({ id: `${id}-${lang}`, use: id, lang, category, title, description, questions });

export const OFFICIAL: OfficialTemplate[] = [
  // Weekly team meeting
  t("team-meeting", "en", "Team", "Weekly team meeting", "Check the mood, agree on the week's focus and collect questions.", [
    Q.words("In one word, how is your week going?"),
    Q.choice("What should we focus on this week?", ["Finish ongoing work", "Support a client", "Plan what comes next", "Fix what slows us down"]),
    Q.qa("Your questions for the team"),
    Q.scale("Was this meeting useful?", ["Not at all", "Very useful"]),
  ]),
  t("team-meeting", "fr", "Team", "Réunion d'équipe hebdomadaire", "L'humeur de l'équipe, la priorité de la semaine et les questions de chacun.", [
    Q.words("En un mot, comment se passe votre semaine ?"),
    Q.choice("Sur quoi nous concentrer cette semaine ?", ["Terminer les sujets en cours", "Accompagner un client", "Préparer la suite", "Régler ce qui nous ralentit"]),
    Q.qa("Vos questions pour l'équipe"),
    Q.scale("Cette réunion vous a-t-elle été utile ?", ["Pas du tout", "Très utile"]),
  ]),

  // Retrospective
  t("retrospective", "en", "Team", "Sprint retrospective", "Look back on the sprint together and choose where to improve.", [
    Q.words("This sprint in one word?"),
    Q.scales("How did the sprint go?", ["We reached the sprint goal", "We worked well together", "Our process helped us"], ["Disagree", "Agree"]),
    Q.countdown("Write down what to keep and what to change", 300),
    Q.open("What should we start doing next sprint?"),
    Q.points("Where should we put our effort next sprint?", ["Code quality", "Testing", "Documentation", "Planning"]),
  ]),
  t("retrospective", "fr", "Team", "Rétrospective de sprint", "Faire le bilan du sprint ensemble et choisir où progresser.", [
    Q.words("Ce sprint en un mot ?"),
    Q.scales("Comment s'est passé le sprint ?", ["Nous avons atteint l'objectif", "Nous avons bien travaillé ensemble", "Notre façon de faire nous a aidés"], ["Pas d'accord", "D'accord"]),
    Q.countdown("Notez ce qu'il faut garder et ce qu'il faut changer", 300),
    Q.open("Que devrions-nous commencer à faire au prochain sprint ?"),
    Q.points("Où mettre nos efforts au prochain sprint ?", ["Qualité du code", "Tests", "Documentation", "Planification"]),
  ]),

  // Project kickoff
  t("project-kickoff", "en", "Team", "Project kickoff", "Align the team on the goal, the risks and the rhythm from day one.", [
    Q.words("In one word, what does success look like for this project?"),
    Q.choice("What is the biggest risk in your view?", ["Deadlines", "Budget", "Resources", "Changing scope"]),
    Q.points("Share 100 points between what matters most", ["Quality", "Speed", "Cost", "Customer impact"]),
    Q.choice("How often should we check in?", ["Every week", "Every two weeks", "Every month"]),
    Q.qa("Questions before we start"),
  ]),
  t("project-kickoff", "fr", "Team", "Lancement de projet", "Aligner l'équipe sur l'objectif, les risques et le rythme dès le premier jour.", [
    Q.words("En un mot, à quoi ressemble la réussite de ce projet ?"),
    Q.choice("Quel est le plus gros risque selon vous ?", ["Les délais", "Le budget", "Les ressources", "Un périmètre qui change"]),
    Q.points("Répartissez 100 points entre ce qui compte le plus", ["Qualité", "Rapidité", "Coût", "Impact client"]),
    Q.choice("À quel rythme faire le point ?", ["Chaque semaine", "Toutes les deux semaines", "Chaque mois"]),
    Q.qa("Vos questions avant de commencer"),
  ]),

  // Onboarding
  t("onboarding", "en", "HR", "New hire onboarding", "Welcome new hires, answer their questions and see what they still need.", [
    Q.slide("Welcome aboard", "Today: who we are, how we work, and who to ask when you need help."),
    Q.words("One word for your first impression?"),
    Q.scales("Where are you after your first days?", ["I know who to ask for help", "I have the tools I need", "My first goals are clear"], ["Not yet", "Yes"]),
    Q.qa("Your questions about the company"),
    Q.open("What would make your first month easier?"),
  ]),
  t("onboarding", "fr", "HR", "Accueil des nouveaux arrivants", "Accueillir les nouveaux, répondre à leurs questions et voir ce qui leur manque.", [
    Q.slide("Bienvenue parmi nous", "Au programme : qui nous sommes, comment nous travaillons et à qui demander de l'aide."),
    Q.words("Votre première impression en un mot ?"),
    Q.scales("Où en êtes-vous après vos premiers jours ?", ["Je sais à qui demander de l'aide", "J'ai les outils nécessaires", "Mes premiers objectifs sont clairs"], ["Pas encore", "Oui"]),
    Q.qa("Vos questions sur l'entreprise"),
    Q.open("Qu'est-ce qui faciliterait votre premier mois ?"),
  ]),

  // Town hall
  t("town-hall", "en", "Events", "Town hall meeting", "Check that the message landed and give everyone a voice with leadership.", [
    Q.slide("Today's agenda", "Results of the quarter, priorities for the next one, then your questions."),
    Q.choice("How clear are the priorities for next quarter?", ["Very clear", "Mostly clear", "Not clear yet"]),
    Q.qa("Ask leadership"),
    Q.rank("Rank the topics for the next town hall", ["Strategy", "Products", "Teams and hiring", "Customers"]),
    Q.scale("How useful was this session?", ["Not useful", "Very useful"]),
  ]),
  t("town-hall", "fr", "Events", "Réunion plénière", "Vérifier que le message est passé et donner la parole à tous face à la direction.", [
    Q.slide("Au programme", "Les résultats du trimestre, les priorités du suivant, puis vos questions."),
    Q.choice("Les priorités du prochain trimestre sont-elles claires ?", ["Très claires", "Plutôt claires", "Pas encore claires"]),
    Q.qa("Vos questions à la direction"),
    Q.rank("Classez les sujets de la prochaine plénière", ["Stratégie", "Produits", "Équipes et recrutement", "Clients"]),
    Q.scale("Cette séance vous a-t-elle été utile ?", ["Pas utile", "Très utile"]),
  ]),

  // Training session
  t("training", "en", "Training", "Training session feedback", "Gauge the starting level, then collect feedback at the end of the session.", [
    Q.choice("What is your level on today's topic?", ["Beginner", "Intermediate", "Advanced"]),
    Q.words("What do you expect from this session?"),
    Q.scales("Your feedback on the session", ["The content was useful", "The pace was right", "I can apply it at work"], ["Disagree", "Agree"]),
    Q.scale("How confident do you feel on the topic now?", ["Not confident", "Very confident"], 10),
    Q.open("One thing you will put into practice"),
  ]),
  t("training", "fr", "Training", "Évaluation d'une formation", "Mesurer le niveau de départ, puis recueillir l'avis des participants en fin de séance.", [
    Q.choice("Quel est votre niveau sur le sujet du jour ?", ["Débutant", "Intermédiaire", "Avancé"]),
    Q.words("Qu'attendez-vous de cette séance ?"),
    Q.scales("Votre avis sur la séance", ["Le contenu était utile", "Le rythme était adapté", "Je peux l'appliquer au travail"], ["Pas d'accord", "D'accord"]),
    Q.scale("Quel est votre niveau de confiance sur le sujet maintenant ?", ["Pas confiant", "Très confiant"], 10),
    Q.open("Une chose que vous allez mettre en pratique"),
  ]),

  // Workshop
  t("workshop", "en", "Team", "Brainstorming workshop", "Frame the problem, collect ideas in groups and agree on what matters most.", [
    Q.words("What problem are we solving today?"),
    Q.countdown("Brainstorm in small groups", 600),
    Q.open("Share your group's best idea"),
    Q.points("Share 100 points between the criteria that matter most", ["Impact", "Cost", "Speed", "Customer value"]),
    Q.scale("How useful was this workshop?", ["Not useful", "Very useful"]),
  ]),
  t("workshop", "fr", "Team", "Atelier de brainstorming", "Poser le problème, réunir les idées en groupes et choisir ce qui compte le plus.", [
    Q.words("Quel problème voulons-nous résoudre aujourd'hui ?"),
    Q.countdown("Réflexion en petits groupes", 600),
    Q.open("Partagez la meilleure idée de votre groupe"),
    Q.points("Répartissez 100 points entre les critères les plus importants", ["Impact", "Coût", "Rapidité", "Valeur pour le client"]),
    Q.scale("Cet atelier vous a-t-il été utile ?", ["Pas utile", "Très utile"]),
  ]),

  // Conference
  t("conference", "en", "Events", "Conference session", "Engage the audience during a talk and leave with feedback and contacts.", [
    Q.choice("Where are you following this session from?", ["In the room", "Online", "On replay"]),
    Q.words("What brought you to this session?"),
    Q.qa("Your questions for the speaker"),
    Q.scales("Your feedback on the talk", ["The topic was relevant", "The speaker was clear", "I learned something new"], ["Disagree", "Agree"]),
    Q.contact("Get the slides after the session", ["name", "email", "company"]),
  ]),
  t("conference", "fr", "Events", "Session de conférence", "Faire participer le public pendant une intervention et repartir avec des avis et des contacts.", [
    Q.choice("D'où suivez-vous cette session ?", ["Dans la salle", "En ligne", "En différé"]),
    Q.words("Qu'est-ce qui vous amène à cette session ?"),
    Q.qa("Vos questions pour l'intervenant"),
    Q.scales("Votre avis sur l'intervention", ["Le sujet était pertinent", "L'intervenant était clair", "J'ai appris quelque chose"], ["Pas d'accord", "D'accord"]),
    Q.contact("Recevez les slides après la session", ["name", "email", "company"]),
  ]),

  // Webinar
  t("webinar", "en", "Events", "Webinar", "Know who is attending, take their questions live and follow up after.", [
    Q.choice("What best describes your role?", ["Management", "Operations", "Sales and marketing", "Technical", "Other"]),
    Q.choice("How familiar are you with today's topic?", ["New to it", "Some experience", "Very familiar"]),
    Q.qa("Ask your questions as we go"),
    Q.scale("How likely are you to recommend this webinar?", ["Not likely", "Very likely"], 10),
    Q.contact("Get the replay by email", ["name", "email"]),
  ]),
  t("webinar", "fr", "Events", "Webinaire", "Savoir qui participe, répondre aux questions en direct et assurer le suivi.", [
    Q.choice("Quel est votre métier ?", ["Direction", "Opérations", "Commercial et marketing", "Technique", "Autre"]),
    Q.choice("Connaissez-vous déjà le sujet du jour ?", ["Je découvre", "Un peu", "Très bien"]),
    Q.qa("Posez vos questions au fil de l'eau"),
    Q.scale("Recommanderiez-vous ce webinaire ?", ["Peu probable", "Très probable"], 10),
    Q.contact("Recevez le replay par email", ["name", "email"]),
  ]),

  // Classroom
  t("classroom", "en", "Training", "Classroom warm-up quiz", "Five quick questions to start a lesson with the whole class involved.", [
    Q.quiz("Which planet is closest to the Sun?", ["Venus", "Mercury", "Mars", "Earth"], 1),
    Q.order("Put these planets in order from the Sun", ["Mercury", "Venus", "Earth", "Mars"]),
    Q.number("How many days are there in a leap year?", 366),
    Q.fill("Complete the sentence", "Water freezes at [0] degrees Celsius and boils at [100] degrees at sea level.", ["10", "50"]),
    Q.match("Match each animal to its group", [["Eagle", "Bird"], ["Shark", "Fish"], ["Frog", "Amphibian"], ["Whale", "Mammal"]]),
  ]),
  t("classroom", "fr", "Training", "Quiz de début de cours", "Cinq questions rapides pour lancer un cours avec toute la classe.", [
    Q.quiz("Quelle planète est la plus proche du Soleil ?", ["Vénus", "Mercure", "Mars", "La Terre"], 1),
    Q.order("Remettez ces planètes dans l'ordre depuis le Soleil", ["Mercure", "Vénus", "La Terre", "Mars"]),
    Q.number("Combien de jours compte une année bissextile ?", 366),
    Q.fill("Complétez la phrase", "L'eau gèle à [0] degré Celsius et bout à [100] degrés au niveau de la mer.", ["10", "50"]),
    Q.match("Associez chaque animal à sa famille", [["Aigle", "Oiseau"], ["Requin", "Poisson"], ["Grenouille", "Amphibien"], ["Baleine", "Mammifère"]]),
  ]),

  // Quiz night
  t("quiz-night", "en", "Events", "General knowledge quiz night", "A ready quiz for a team evening: a capital, a date, a timeline and famous paintings.", [
    Q.wheel("Spin for the first category", ["History", "Science", "Geography", "Art", "Sport"]),
    Q.quiz("What is the capital of Canada?", ["Toronto", "Ottawa", "Montreal", "Vancouver"], 1),
    Q.number("In which year did humans first walk on the Moon?", 1969),
    Q.order("Put these events in chronological order", ["French Revolution", "First World War", "First Moon landing", "Fall of the Berlin Wall"]),
    Q.match("Match each painting to its painter", [["Mona Lisa", "Leonardo da Vinci"], ["The Starry Night", "Vincent van Gogh"], ["Guernica", "Pablo Picasso"], ["Impression, Sunrise", "Claude Monet"]]),
  ]),
  t("quiz-night", "fr", "Events", "Soirée quiz culture générale", "Un quiz prêt pour une soirée d'équipe : une capitale, une date, une chronologie et des tableaux.", [
    Q.wheel("Tournez la roue pour la première catégorie", ["Histoire", "Sciences", "Géographie", "Art", "Sport"]),
    Q.quiz("Quelle est la capitale du Canada ?", ["Toronto", "Ottawa", "Montréal", "Vancouver"], 1),
    Q.number("En quelle année l'homme a-t-il marché sur la Lune pour la première fois ?", 1969),
    Q.order("Remettez ces événements dans l'ordre chronologique", ["Révolution française", "Première Guerre mondiale", "Premiers pas sur la Lune", "Chute du mur de Berlin"]),
    Q.match("Associez chaque tableau à son peintre", [["La Joconde", "Léonard de Vinci"], ["La Nuit étoilée", "Vincent van Gogh"], ["Guernica", "Pablo Picasso"], ["Impression, soleil levant", "Claude Monet"]]),
  ]),

  // Quiz night in topic rounds: the wheel picks 3 of the 4 topics, one stays aside.
  t("quiz-rounds", "en", "Events", "Quiz night: 3 rounds", "The wheel picks each round's topic among 4. Three are played, the fourth stays aside.", [
    Q.rounds("What will the next topic be?", "wheel", ["Geography", "History", "Science", "Art"], 3),
    Q.inTopic(0, Q.quiz("What is the capital of Australia?", ["Sydney", "Melbourne", "Canberra", "Perth"], 2)),
    Q.inTopic(1, Q.number("In which year did the Berlin Wall fall?", 1989)),
    Q.inTopic(2, Q.quiz("What is the chemical symbol for gold?", ["Ag", "Au", "Gd"], 1)),
    Q.inTopic(3, Q.quiz("Who painted The Starry Night?", ["Vincent van Gogh", "Claude Monet", "Paul Cézanne"], 0)),
  ]),
  t("quiz-rounds", "fr", "Events", "Soirée quiz : 3 manches", "La roue tire le thème de chaque manche parmi 4. Trois sont joués, le quatrième reste de côté.", [
    Q.rounds("Quel sera le prochain thème ?", "wheel", ["Géographie", "Histoire", "Sciences", "Art"], 3),
    Q.inTopic(0, Q.quiz("Quelle est la capitale de l'Australie ?", ["Sydney", "Melbourne", "Canberra", "Perth"], 2)),
    Q.inTopic(1, Q.number("En quelle année le mur de Berlin est-il tombé ?", 1989)),
    Q.inTopic(2, Q.quiz("Quel est le symbole chimique de l'or ?", ["Ag", "Au", "Gd"], 1)),
    Q.inTopic(3, Q.quiz("Qui a peint La Nuit étoilée ?", ["Vincent van Gogh", "Claude Monet", "Paul Cézanne"], 0)),
  ]),

  // Team building
  t("team-building", "en", "Team", "Team building icebreaker", "Get people talking in the first minutes, with a wheel over the first names in the room.", [
    Q.wheel("Who introduces themselves first?"),
    Q.choice("Would you rather work from the beach or from a mountain cabin?", ["From the beach", "From a mountain cabin"]),
    Q.number("How many countries have you visited?"),
    Q.words("One word that describes our team"),
    Q.open("Share a fun fact about yourself"),
  ]),
  t("team-building", "fr", "Team", "Brise-glace team building", "Lancer les échanges dès les premières minutes, avec une roue sur les prénoms de la salle.", [
    Q.wheel("Qui se présente en premier ?"),
    Q.choice("Plutôt télétravail à la plage ou dans un chalet à la montagne ?", ["À la plage", "Dans un chalet"]),
    Q.number("Combien de pays avez-vous visités ?"),
    Q.words("Un mot qui décrit notre équipe"),
    Q.open("Partagez une anecdote sur vous"),
  ]),
];

export const officialTemplate = (id: string | null | undefined) => OFFICIAL.find((t) => t.id === id);
