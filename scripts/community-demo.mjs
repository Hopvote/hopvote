// The demo Community content for the LOCAL database: fictional authors (worker/demo-authors.ts) and about 30 decks
// in English and French, using every kind of question that needs no file of its own (find on the image needs an
// uploaded picture, video or audio a link the maintainer picks). Seeded by scripts/seed-community.mjs, checked by
// scripts/community-test.mjs. Facts in the quizzes are well known and easy to verify; no dashes in any text.
import { createHash } from "node:crypto";
import { DEMO_AUTHORS, demoAuthorEmail, demoAuthorId } from "../worker/demo-authors.ts";
import { Q } from "../src/official-templates.ts";

export { DEMO_AUTHORS, demoAuthorEmail, demoAuthorId };

// Community ids are 16 hex characters (the /api/templates/:id routes check it); the same slug always gives the same id.
export const templateId = (slug) => createHash("sha256").update(`hopvote-demo:${slug}`).digest("hex").slice(0, 16);

const d = (slug, author, category, title, description, uses, daysAgo, questions) => ({ slug, author, category, title, description, uses, daysAgo, questions });

export const DECKS = [
  // English
  d("platform-sprint-review", "daniel-okafor", "Team", "Platform team sprint review", "Show what shipped, check how the sprint felt and pick the next focus.", 34, 6, [
    Q.slide("Sprint review", "What shipped, what slipped, and what we learned along the way."),
    Q.scales("How did this sprint feel?", ["Our goal was clear", "Code reviews were fast enough", "On-call was manageable"], ["Disagree", "Agree"]),
    Q.points("Where should we invest next sprint?", ["Tech debt", "Performance", "New features", "Monitoring"]),
    Q.open("One thing that slowed you down"),
    Q.wheel("Which squad demos first?", ["Payments", "Search", "Mobile", "Infrastructure"]),
  ]),
  d("web-fundamentals-quiz", "daniel-okafor", "Training", "Web fundamentals quiz for new developers", "A friendly knowledge check for the first week of a developer onboarding.", 41, 19, [
    Q.quiz("Which HTTP status code means Not Found?", ["200", "301", "404", "500"], 2),
    Q.match("Match each acronym to its meaning", [["HTML", "HyperText Markup Language"], ["CSS", "Cascading Style Sheets"], ["URL", "Uniform Resource Locator"], ["API", "Application Programming Interface"]]),
    Q.order("Put these languages in order of first release", ["C", "C++", "Python", "Go"]),
    Q.number("In which year was the first website published at CERN?", 1991),
    Q.fill("Complete the sentence", "Git is a distributed [version control] system created by [Linus Torvalds] in 2005.", ["package manager", "Guido van Rossum"]),
  ]),
  d("engineering-all-hands", "daniel-okafor", "Team", "Engineering all-hands", "Share the quarter's results and roadmap, then take questions from the whole team.", 12, 44, [
    Q.slide("Engineering all-hands", "Quarter results, platform roadmap, hiring update and your questions."),
    Q.choice("How clear is the roadmap for next quarter?", ["Very clear", "Mostly clear", "Unclear"]),
    Q.qa("Questions for the leadership team"),
    Q.scale("How sustainable is your current pace?", ["Not sustainable", "Sustainable"]),
    Q.link("Read the full roadmap", "https://example.com/roadmap"),
  ]),
  d("new-starter-week-one", "sarah-mitchell", "HR", "New starter week one check-in", "A short session at the end of week one to see how new joiners are settling in.", 27, 9, [
    Q.words("Your first week in one word"),
    Q.scales("How ready do you feel?", ["I understand my role", "I have access to every tool", "I know my team's priorities"], ["Not yet", "Fully"]),
    Q.choice("What would help you most now?", ["A buddy to ask questions", "More time with my manager", "Clearer documentation", "Meeting other teams"]),
    Q.qa("Anything you have wanted to ask but did not?"),
    Q.link("Read the employee handbook", "https://example.com/handbook"),
  ]),
  d("quarterly-engagement-pulse", "sarah-mitchell", "HR", "Quarterly engagement pulse", "Five anonymous questions to follow team engagement from one quarter to the next.", 48, 63, [
    Q.scale("How happy are you at work right now?", ["Not happy", "Very happy"], 10),
    Q.scales("How much do you agree?", ["My workload is manageable", "I get useful feedback", "I see a future for myself here"], ["Disagree", "Agree"]),
    Q.points("Share 100 points between what would improve your work", ["Flexible hours", "Training budget", "Better tools", "Team events"]),
    Q.choice("How do you prefer to hear company news?", ["All-hands meetings", "A weekly email", "Team meetings", "The intranet"]),
    Q.open("What is one thing we should change?"),
  ]),
  d("year-9-science-starter", "emily-carter", "Training", "Year 9 science lesson starter", "Five quick questions on biology and chemistry to open the lesson.", 22, 14, [
    Q.quiz("Which gas do plants absorb from the air for photosynthesis?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], 2),
    Q.match("Match each element to its symbol", [["Gold", "Au"], ["Iron", "Fe"], ["Sodium", "Na"], ["Silver", "Ag"]]),
    Q.number("How many bones are there in the adult human body?", 206),
    Q.fill("Complete the sentence", "The [heart] pumps blood around the body, and the [lungs] bring oxygen into it.", ["liver", "kidneys"]),
    Q.order("Put these levels of organisation in order, smallest first", ["Cell", "Tissue", "Organ", "Organ system"]),
  ]),
  d("end-of-term-feedback", "emily-carter", "Training", "End of term class feedback", "Ask students how the term went and what would help them next term.", 9, 37, [
    Q.scale("How much did you enjoy this term's lessons?", ["Not much", "A lot"]),
    Q.scales("How confident are you on each topic?", ["Cells and organisms", "Chemical reactions", "Forces and motion"], ["Not confident", "Very confident"]),
    Q.words("One word for this term"),
    Q.rank("Rank the activities you found most useful", ["Experiments", "Quizzes", "Group projects", "Revision sheets"]),
    Q.open("What would help you learn better next term?"),
  ]),
  d("conference-opening-session", "james-whitfield", "Events", "Conference opening session", "Welcome attendees, learn why they came and collect questions for the panel.", 31, 11, [
    Q.slide("Welcome to day one", "Keynotes this morning, breakout sessions after lunch, networking from 6 pm."),
    Q.choice("What is your main goal today?", ["Learn about new trends", "Meet peers", "Find suppliers", "Hear customer stories"]),
    Q.words("Which topic are you most curious about?"),
    Q.qa("Questions for the opening panel"),
    Q.link("Open the agenda on your phone", "https://example.com/agenda"),
  ]),
  d("post-event-attendee-survey", "james-whitfield", "Events", "Post-event attendee survey", "Rate the day part by part and keep in touch for next year's edition.", 18, 52, [
    Q.scale("Overall, how would you rate the event?", ["Poor", "Excellent"], 10),
    Q.scales("Rate each part of the day", ["Keynotes", "Breakout sessions", "Venue and catering", "Networking"], ["Poor", "Excellent"]),
    Q.choice("Would you attend next year?", ["Yes", "Maybe", "No"]),
    Q.open("What should we improve for next year?"),
    Q.contact("Stay informed about next year's edition", ["name", "email", "company"]),
  ]),
  d("annual-training-needs", "priya-nair", "Training", "Annual training needs survey", "Find out which skills and formats your teams want before planning the budget.", 15, 71, [
    Q.choice("Which skills do you want to develop this year?", ["Leadership", "Data analysis", "Public speaking", "Project management", "Writing"], true),
    Q.points("Share 100 points between these learning formats", ["Workshops", "E-learning", "Mentoring", "Conferences"]),
    Q.rank("Rank these topics by priority for your team", ["Onboarding new managers", "Customer service skills", "Health and safety", "Digital tools"]),
    Q.scale("How well does current training meet your needs?", ["Not at all", "Fully"]),
    Q.open("Which course would make the biggest difference to your work?"),
  ]),
  d("workshop-check-in-close", "priya-nair", "Training", "Workshop check-in and closing round", "Open a workshop with a check-in, time the pair work, and close with next steps.", 24, 23, [
    Q.words("How are you arriving today, in one word?"),
    Q.choice("What do you want to take away from this workshop?", ["Practical tools", "New ideas", "Time with peers", "A clear plan"]),
    Q.countdown("Pair exercise: discuss your current challenge", 480),
    Q.scale("How useful was today?", ["Not useful", "Very useful"]),
    Q.open("What is your first step after this workshop?"),
  ]),
  d("pub-quiz-general-knowledge", "lucas-bennett", "Events", "Pub quiz: general knowledge", "Oceans, inventions, capitals and landmarks for a relaxed team evening.", 39, 4, [
    Q.quiz("What is the largest ocean on Earth?", ["Atlantic", "Indian", "Pacific", "Arctic"], 2),
    Q.number("How many squares are there on a chessboard?", 64),
    Q.order("Put these inventions in order, oldest first", ["Printing press", "Steam engine", "Telephone", "World Wide Web"]),
    Q.match("Match each capital to its country", [["Canberra", "Australia"], ["Ottawa", "Canada"], ["Brasília", "Brazil"], ["Wellington", "New Zealand"]]),
    Q.fill("Complete the sentence", "The Great Wall is in [China] and the Taj Mahal is in [India].", ["Japan", "Nepal"]),
  ]),
  d("sports-quiz-night", "lucas-bennett", "Events", "Sports quiz night", "Olympics, marathons, team sizes and tennis scoring in five rounds.", 29, 28, [
    Q.quiz("How often are the Summer Olympic Games held?", ["Every 2 years", "Every 4 years", "Every 5 years", "Every 6 years"], 1),
    Q.number("How long is a marathon, in kilometres?", 42.195),
    Q.match("Match each sport to its number of players per team on the field", [["Basketball", "5"], ["Volleyball", "6"], ["Football", "11"], ["Rugby union", "15"]]),
    Q.fill("Complete the sentence", "In tennis, a score of zero is called [love], and 40 all is called [deuce].", ["nil", "advantage"]),
    Q.order("Put these Summer Olympics host cities in chronological order", ["Barcelona", "Sydney", "London", "Paris"]),
  ]),
  d("product-discovery-workshop", "hannah-schultz", "Team", "Product discovery workshop", "Sketch ideas in silence, then vote on what to build and which risks to test first.", 20, 16, [
    Q.words("Who is the user we are designing for?"),
    Q.countdown("Silent sketching: draw three ideas", 300),
    Q.open("Describe your strongest idea in one sentence"),
    Q.points("Share 100 points between the ideas on the board", ["Guided setup", "Smart templates", "Team dashboard", "Mobile app"]),
    Q.rank("Rank the risks to test first", ["Users do not need it", "Too hard to build", "Users cannot find it", "It does not pay off"]),
  ]),
  d("design-offsite-icebreaker", "hannah-schultz", "Team", "Design team offsite icebreaker", "Warm up the room with a wheel over first names and a few light questions.", 13, 33, [
    Q.wheel("Who shares first?"),
    Q.choice("Which tool could you not work without?", ["Figma", "A notebook", "Sticky notes", "A whiteboard"]),
    Q.number("How many cups of coffee do you drink on a workday?"),
    Q.words("One word for how this team works"),
    Q.open("A project you are proud of this year"),
  ]),

  // Français
  d("matinee-integration", "claire-dubois", "HR", "Matinée d'intégration des nouveaux arrivants", "Présenter l'entreprise, faire connaissance et répondre aux questions des nouveaux.", 26, 8, [
    Q.slide("Bienvenue chez nous", "Ce matin : notre histoire, nos métiers, les règles utiles et la visite des locaux."),
    Q.words("Un mot pour décrire votre arrivée"),
    Q.wheel("Qui se présente en premier ?"),
    Q.scales("Où en êtes-vous ?", ["Je connais mon équipe", "J'ai accès à mes outils", "Je sais à qui m'adresser"], ["Pas encore", "Oui"]),
    Q.qa("Vos questions sur l'entreprise"),
  ]),
  d("barometre-qvt", "claire-dubois", "HR", "Baromètre qualité de vie au travail", "Cinq questions anonymes pour suivre le moral et la charge de travail chaque trimestre.", 44, 58, [
    Q.scale("Comment vous sentez-vous au travail en ce moment ?", ["Pas bien", "Très bien"], 10),
    Q.scales("Êtes-vous d'accord avec ces affirmations ?", ["Ma charge de travail est raisonnable", "Je concilie vie pro et vie perso", "Je me sens reconnu dans mon travail"], ["Pas d'accord", "Tout à fait"]),
    Q.points("Répartissez 100 points entre ce qui améliorerait votre quotidien", ["Horaires flexibles", "Télétravail", "Formation", "Espaces de travail"]),
    Q.choice("L'organisation actuelle du télétravail vous convient-elle ?", ["Oui, tout à fait", "Plutôt oui", "Plutôt non", "Non"]),
    Q.open("Une idée pour mieux travailler ensemble ?"),
  ]),
  d("evaluation-a-chaud", "julien-moreau", "Training", "Évaluation à chaud de fin de formation", "Recueillir l'avis des stagiaires avant leur départ et leur envoyer les supports.", 37, 12, [
    Q.scale("Note globale de la formation", ["Décevante", "Excellente"], 10),
    Q.scales("Votre avis sur chaque point", ["Contenu", "Animation", "Supports", "Organisation"], ["Insuffisant", "Très bien"]),
    Q.words("Ce que vous retenez, en un mot"),
    Q.open("Qu'aimeriez-vous approfondir ?"),
    Q.contact("Recevez les supports et l'attestation", ["name", "email", "company"]),
  ]),
  d("quiz-excel-debutants", "julien-moreau", "Training", "Quiz Excel pour débutants", "Vérifier les bases du tableur en fin de première journée de formation.", 33, 26, [
    Q.quiz("Par quel symbole commence une formule dans Excel ?", ["@", "=", "#", "%"], 1),
    Q.match("Associez chaque fonction à ce qu'elle fait", [["SOMME", "Additionne des valeurs"], ["MOYENNE", "Calcule la moyenne"], ["MAX", "Renvoie la plus grande valeur"], ["SI", "Teste une condition"]]),
    Q.fill("Complétez la phrase", "Dans Excel, les colonnes sont désignées par des [lettres] et les lignes par des [numéros/chiffres/nombres].", ["couleurs", "symboles"]),
    Q.order("Remettez dans l'ordre les étapes pour créer un graphique", ["Sélectionner les données", "Ouvrir l'onglet Insertion", "Choisir un type de graphique", "Ajouter un titre"]),
    Q.number("Combien de colonnes compte une feuille Excel ?", 16384),
  ]),
  d("sensibilisation-rgpd", "julien-moreau", "Training", "Sensibilisation au RGPD", "Les notions clés de la protection des données, à vérifier en fin de session.", 19, 47, [
    Q.quiz("Depuis quelle année le RGPD s'applique-t-il ?", ["2016", "2018", "2020", "2022"], 1),
    Q.number("En combien d'heures au plus faut-il notifier une violation de données à la CNIL ?", 72),
    Q.match("Associez chaque notion à sa définition", [["Donnée personnelle", "Information sur une personne identifiable"], ["Responsable de traitement", "Décide pourquoi et comment les données sont traitées"], ["Sous-traitant", "Traite les données pour le compte d'un autre"], ["DPO", "Délégué à la protection des données"]]),
    Q.fill("Complétez la phrase", "Les données doivent être [exactes] et conservées pendant une durée [limitée].", ["illimitée", "publiques"]),
    Q.scale("Vous sentez-vous à l'aise avec ces règles ?", ["Pas du tout", "Tout à fait"]),
  ]),
  d("revisions-geographie", "sophie-laurent", "Training", "Révisions de géographie au collège", "Fleuves, capitales, océans et régions pour réviser avant le contrôle.", 21, 18, [
    Q.quiz("Quel est le plus long fleuve de France ?", ["La Seine", "La Loire", "Le Rhône", "La Garonne"], 1),
    Q.match("Associez chaque pays à sa capitale", [["Espagne", "Madrid"], ["Portugal", "Lisbonne"], ["Pologne", "Varsovie"], ["Grèce", "Athènes"]]),
    Q.order("Classez ces océans du plus grand au plus petit", ["Pacifique", "Atlantique", "Indien", "Arctique"]),
    Q.number("Combien de régions compte la France métropolitaine ?", 13),
    Q.fill("Complétez la phrase", "Paris est traversée par la [Seine], et Lyon par le Rhône et la [Saône].", ["Loire", "Garonne"]),
  ]),
  d("reperes-histoire", "sophie-laurent", "Training", "Repères d'histoire : quiz de révision", "Dates et personnages clés, avec une roue pour choisir qui répond.", 16, 40, [
    Q.order("Remettez ces événements dans l'ordre", ["Sacre de Charlemagne", "Arrivée de Christophe Colomb en Amérique", "Révolution française", "Première Guerre mondiale"]),
    Q.number("En quelle année a eu lieu la prise de la Bastille ?", 1789),
    Q.quiz("Qui fut le premier empereur des Français ?", ["Louis XIV", "Napoléon Ier", "Charlemagne", "Napoléon III"], 1),
    Q.match("Associez chaque personnage à son époque", [["Jules César", "Antiquité"], ["Jeanne d'Arc", "Moyen Âge"], ["Louis XIV", "Époque moderne"], ["Charles de Gaulle", "Époque contemporaine"]]),
    Q.wheel("Qui répond à la prochaine question ?"),
  ]),
  d("quiz-soiree-entreprise", "thomas-girard", "Events", "Quiz de la soirée d'entreprise", "Europe, monuments et inventions : un quiz prêt pour animer la soirée.", 42, 5, [
    Q.quiz("Combien de pays sont membres de l'Union européenne ?", ["25", "27", "28", "30"], 1),
    Q.number("En quelle année les pièces et billets en euros sont-ils entrés en circulation ?", 2002),
    Q.match("Associez chaque monument à sa ville", [["La Sagrada Família", "Barcelone"], ["Le Colisée", "Rome"], ["Big Ben", "Londres"], ["La porte de Brandebourg", "Berlin"]]),
    Q.order("Classez ces inventions de la plus ancienne à la plus récente", ["L'imprimerie", "La machine à vapeur", "Le téléphone", "Le Web"]),
    Q.fill("Complétez la phrase", "La tour Eiffel a été construite pour l'Exposition universelle de [1889] à [Paris].", ["1900", "Lyon"]),
  ]),
  d("seminaire-ouverture", "thomas-girard", "Events", "Séminaire annuel : séance d'ouverture", "Lancer les deux jours, recueillir les attentes et les questions pour la direction.", 17, 30, [
    Q.slide("Bienvenue au séminaire annuel", "Deux jours pour faire le bilan, partager la stratégie et travailler ensemble."),
    Q.choice("Qu'attendez-vous le plus de ces deux jours ?", ["Comprendre la stratégie", "Échanger avec les autres équipes", "Les ateliers", "La soirée"]),
    Q.words("Notre année en un mot ?"),
    Q.qa("Vos questions à la direction"),
    Q.link("Le programme détaillé", "https://example.com/programme"),
  ]),
  d("retro-equipe-produit", "camille-lefevre", "Team", "Rétrospective de l'équipe produit", "Prendre la température, écrire ses post-it en temps limité et voter les actions.", 35, 10, [
    Q.words("Le sprint en un mot ?"),
    Q.scale("Quelle est votre énergie en fin de sprint ?", ["À plat", "En pleine forme"]),
    Q.countdown("Vos post-it : ce qui a marché, ce qui a coincé", 420),
    Q.open("Ce qui nous a fait perdre du temps"),
    Q.points("Répartissez 100 points entre les actions proposées", ["Mieux découper les tickets", "Relire le code plus vite", "Moins de réunions", "Clarifier les priorités"]),
  ]),
  d("atelier-priorisation", "camille-lefevre", "Team", "Atelier de priorisation de la feuille de route", "Choisir ensemble les chantiers du prochain trimestre, en groupes puis en vote.", 23, 35, [
    Q.slide("Objectif de l'atelier", "Choisir ensemble les trois chantiers du prochain trimestre."),
    Q.rank("Classez ces chantiers par valeur pour nos clients", ["Nouvel accueil des clients", "Application mobile", "Exports avancés", "Intégrations"]),
    Q.countdown("Travail en groupes", 900),
    Q.wheel("Quel groupe présente en premier ?", ["Groupe A", "Groupe B", "Groupe C"]),
    Q.points("Répartissez 100 points entre les chantiers à lancer en premier", ["Nouvel accueil des clients", "Application mobile", "Exports avancés", "Intégrations"]),
  ]),
  d("quiz-sport-mondial-jo", "nicolas-fontaine", "Events", "Quiz sport : Coupe du monde et JO", "Football, rugby, JO et tennis : cinq questions pour une soirée au club.", 30, 21, [
    Q.quiz("Quel pays a remporté la Coupe du monde de football 2018 ?", ["Croatie", "Brésil", "France", "Allemagne"], 2),
    Q.number("Combien de joueurs compte une équipe de rugby à XV sur le terrain ?", 15),
    Q.order("Classez ces villes hôtes des JO d'été dans l'ordre chronologique", ["Barcelone", "Sydney", "Londres", "Paris"]),
    Q.match("Associez chaque sportif à son sport", [["Teddy Riner", "Judo"], ["Tony Parker", "Basket-ball"], ["Marie-José Pérec", "Athlétisme"], ["Zinédine Zidane", "Football"]]),
    Q.fill("Complétez la phrase", "Roland-Garros se joue sur [terre battue] et Wimbledon sur [gazon].", ["dur", "moquette"]),
  ]),
  d("reunion-rentree-club", "nicolas-fontaine", "Events", "Réunion de rentrée du club", "Créneaux, projets de la saison, questions au bureau et appel aux bénévoles.", 11, 66, [
    Q.slide("Bienvenue pour cette nouvelle saison", "Au programme : les horaires, les compétitions, le bénévolat et vos questions."),
    Q.choice("Quels créneaux d'entraînement vous conviennent ?", ["Mardi soir", "Mercredi après-midi", "Jeudi soir", "Samedi matin"], true),
    Q.rank("Classez les projets du club pour cette saison", ["Nouveaux maillots", "Tournoi de fin d'année", "Stage pendant les vacances", "Sortie au stade"]),
    Q.qa("Vos questions au bureau du club"),
    Q.contact("Devenez bénévole cette saison", ["name", "email", "phone"]),
  ]),
  d("point-equipe-lundi", "elodie-marchand", "Team", "Point d'équipe du lundi", "L'humeur, la priorité et les sujets de la semaine, avec un tour de table minuté.", 28, 3, [
    Q.words("Votre humeur du lundi en un mot"),
    Q.choice("Quelle est la priorité de la semaine ?", ["La lettre interne", "Le séminaire", "L'intranet", "Les vidéos métiers"]),
    Q.rank("Classez les sujets à traiter aujourd'hui", ["Planning éditorial", "Retours des managers", "Budget", "Outils"]),
    Q.countdown("Tour de table", 600),
    Q.scale("Ce point vous a-t-il été utile ?", ["Pas utile", "Très utile"]),
  ]),
  d("brise-glace-nouvelle-equipe", "elodie-marchand", "Team", "Brise-glace pour une nouvelle équipe", "Faire connaissance en dix minutes, avec une roue sur les prénoms de la salle.", 14, 49, [
    Q.wheel("Qui commence le tour de table ?"),
    Q.choice("Plutôt café ou thé le matin ?", ["Café", "Thé", "Ni l'un ni l'autre"]),
    Q.number("Depuis combien d'années travaillez-vous dans l'entreprise ?"),
    Q.words("Une qualité que vous apportez à l'équipe"),
    Q.open("Une chose que peu de gens savent sur vous"),
  ]),
];

// A wheel without entries spins among first names: like the builder, the deck then asks for them.
export const needsNames = (questions) => questions.some((q) => typeof q.correct === "number") || questions.some((q) => q.type === "wheel" && !q.options.length);

// The rules every deck and official template keeps, checked before seeding and by the test.
const DASH = /[\u2012\u2013\u2014\u2015]/;
export function problems(deck) {
  const out = [];
  const texts = [deck.title, deck.description, ...deck.questions.flatMap((q) => [q.question, ...q.options, ...(q.labels ?? []), q.text ?? "", q.fill ?? "", ...(q.decoys ?? [])])];
  if (deck.title.length >= 60) out.push(`title over 59 characters`);
  if (!deck.description || deck.description.length > 120) out.push(`description empty or over 120 characters`);
  if (!deck.questions.length || deck.questions.length > 5) out.push(`${deck.questions.length} questions`);
  if (texts.some((s) => DASH.test(s))) out.push("an em or en dash");
  for (const q of deck.questions) if (q.question.length > 140) out.push(`question over 140 characters: ${q.question.slice(0, 30)}`);
  return out;
}
