// Fictional Community authors of the LOCAL demo seed (scripts/seed-community.mjs). Their rows are users with the id
// "demo-<slug>" and the email "<slug>@demo.hopvote.invalid": no password, no inbox, nobody can sign in as them.
// The Community page shows their name, buddy and bio with an "Example" mention. No import here: Node loads this file
// too, for the seed. Nothing in production refers to these people unless that seed is run against it.
export type DemoAuthor = { slug: string; name: string; avatar: string; lang: "en" | "fr"; bio: string };

export const DEMO_DOMAIN = "demo.hopvote.invalid";

export const DEMO_AUTHORS: DemoAuthor[] = [
  { slug: "claire-dubois", name: "Claire Dubois", avatar: "b4", lang: "fr", bio: "Responsable RH dans une PME industrielle, à Lyon" },
  { slug: "julien-moreau", name: "Julien Moreau", avatar: "b2", lang: "fr", bio: "Formateur bureautique et conformité, à Nantes" },
  { slug: "sophie-laurent", name: "Sophie Laurent", avatar: "b11", lang: "fr", bio: "Professeure d'histoire-géographie au collège, à Bordeaux" },
  { slug: "thomas-girard", name: "Thomas Girard", avatar: "b9", lang: "fr", bio: "Chef de projet événementiel, à Paris" },
  { slug: "camille-lefevre", name: "Camille Lefèvre", avatar: "b16", lang: "fr", bio: "Coach agile pour des équipes produit, à Lille" },
  { slug: "nicolas-fontaine", name: "Nicolas Fontaine", avatar: "b7", lang: "fr", bio: "Éducateur sportif et dirigeant de club, à Toulouse" },
  { slug: "elodie-marchand", name: "Élodie Marchand", avatar: "b13", lang: "fr", bio: "Responsable de la communication interne, à Rennes" },
  { slug: "sarah-mitchell", name: "Sarah Mitchell", avatar: "b1", lang: "en", bio: "People operations lead at a software company, Manchester" },
  { slug: "daniel-okafor", name: "Daniel Okafor", avatar: "b14", lang: "en", bio: "Engineering manager for a web platform team, London" },
  { slug: "emily-carter", name: "Emily Carter", avatar: "b23", lang: "en", bio: "Secondary school science teacher, Leeds" },
  { slug: "james-whitfield", name: "James Whitfield", avatar: "b6", lang: "en", bio: "Conference and event producer, Dublin" },
  { slug: "priya-nair", name: "Priya Nair", avatar: "b19", lang: "en", bio: "Learning and development specialist, Toronto" },
  { slug: "lucas-bennett", name: "Lucas Bennett", avatar: "b3", lang: "en", bio: "Quiz host for corporate events, Bristol" },
  { slug: "hannah-schultz", name: "Hannah Schultz", avatar: "b20", lang: "en", bio: "Product designer running discovery workshops, Berlin" },
];

export const demoAuthorId = (slug: string) => `demo-${slug}`;
export const demoAuthorEmail = (slug: string) => `${slug}@${DEMO_DOMAIN}`;
// A demo row needs both marks: real ids are random UUIDs and no real address ends with the reserved .invalid domain.
export const isDemoUser = (id: string, email: string | null | undefined) => id.startsWith("demo-") && !!email?.endsWith(`@${DEMO_DOMAIN}`);
export const demoAuthor = (id: string) => DEMO_AUTHORS.find((a) => demoAuthorId(a.slug) === id);
