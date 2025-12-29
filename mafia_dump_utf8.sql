--
-- PostgreSQL database dump
--

\restrict icn4EktmQWewdJc3pSnlgSYKOLYyHhI3NrkWCRlionxR9NjZNayllsHIeZmXKgP

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.0

-- Started on 2025-12-26 16:25:29

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 226 (class 1259 OID 16437)
-- Name: match_players; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.match_players (
    id integer NOT NULL,
    match_id integer,
    user_id integer,
    role character varying(20),
    alive boolean DEFAULT true,
    joined_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.match_players OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16436)
-- Name: match_players_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.match_players_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.match_players_id_seq OWNER TO postgres;

--
-- TOC entry 5050 (class 0 OID 0)
-- Dependencies: 225
-- Name: match_players_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.match_players_id_seq OWNED BY public.match_players.id;


--
-- TOC entry 224 (class 1259 OID 16427)
-- Name: matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.matches (
    id integer NOT NULL,
    name character varying(50),
    status character varying(20) DEFAULT 'waiting'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.matches OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16426)
-- Name: matches_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.matches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.matches_id_seq OWNER TO postgres;

--
-- TOC entry 5051 (class 0 OID 0)
-- Dependencies: 223
-- Name: matches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.matches_id_seq OWNED BY public.matches.id;


--
-- TOC entry 230 (class 1259 OID 16476)
-- Name: room_players; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.room_players (
    id integer NOT NULL,
    room_id integer,
    user_id integer,
    role character varying(50),
    joined_at timestamp without time zone DEFAULT now(),
    is_alive boolean DEFAULT true,
    voted_for integer,
    last_action_target integer,
    is_ready boolean DEFAULT false
);


ALTER TABLE public.room_players OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 16475)
-- Name: room_players_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.room_players_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.room_players_id_seq OWNER TO postgres;

--
-- TOC entry 5052 (class 0 OID 0)
-- Dependencies: 229
-- Name: room_players_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.room_players_id_seq OWNED BY public.room_players.id;


--
-- TOC entry 228 (class 1259 OID 16459)
-- Name: rooms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rooms (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    password character varying(255),
    min_players integer NOT NULL,
    max_players integer NOT NULL,
    level integer DEFAULT 1,
    roles jsonb NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    phase text DEFAULT 'waiting'::text,
    phase_end_time bigint DEFAULT 0,
    game_started boolean DEFAULT false,
    alive_count integer DEFAULT 0,
    mafia_count integer DEFAULT 1
);


ALTER TABLE public.rooms OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16458)
-- Name: rooms_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rooms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rooms_id_seq OWNER TO postgres;

--
-- TOC entry 5053 (class 0 OID 0)
-- Dependencies: 227
-- Name: rooms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rooms_id_seq OWNED BY public.rooms.id;


--
-- TOC entry 222 (class 1259 OID 16410)
-- Name: tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tokens (
    id integer NOT NULL,
    user_id integer,
    token character varying(64) NOT NULL,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.tokens OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16409)
-- Name: tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tokens_id_seq OWNER TO postgres;

--
-- TOC entry 5054 (class 0 OID 0)
-- Dependencies: 221
-- Name: tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tokens_id_seq OWNED BY public.tokens.id;


--
-- TOC entry 220 (class 1259 OID 16390)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    avatar_id integer DEFAULT 1,
    balance integer DEFAULT 0,
    experience integer DEFAULT 0,
    level integer DEFAULT 1,
    wins integer DEFAULT 0,
    losses integer DEFAULT 0,
    is_banned boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    password character varying(255)
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16389)
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- TOC entry 5055 (class 0 OID 0)
-- Dependencies: 219
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- TOC entry 4850 (class 2604 OID 16440)
-- Name: match_players id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_players ALTER COLUMN id SET DEFAULT nextval('public.match_players_id_seq'::regclass);


--
-- TOC entry 4847 (class 2604 OID 16430)
-- Name: matches id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches ALTER COLUMN id SET DEFAULT nextval('public.matches_id_seq'::regclass);


--
-- TOC entry 4861 (class 2604 OID 16479)
-- Name: room_players id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.room_players ALTER COLUMN id SET DEFAULT nextval('public.room_players_id_seq'::regclass);


--
-- TOC entry 4853 (class 2604 OID 16462)
-- Name: rooms id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms ALTER COLUMN id SET DEFAULT nextval('public.rooms_id_seq'::regclass);


--
-- TOC entry 4845 (class 2604 OID 16413)
-- Name: tokens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens ALTER COLUMN id SET DEFAULT nextval('public.tokens_id_seq'::regclass);


--
-- TOC entry 4835 (class 2604 OID 16393)
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- TOC entry 5040 (class 0 OID 16437)
-- Dependencies: 226
-- Data for Name: match_players; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.match_players (id, match_id, user_id, role, alive, joined_at) FROM stdin;
\.


--
-- TOC entry 5038 (class 0 OID 16427)
-- Dependencies: 224
-- Data for Name: matches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.matches (id, name, status, created_at) FROM stdin;
\.


--
-- TOC entry 5044 (class 0 OID 16476)
-- Dependencies: 230
-- Data for Name: room_players; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.room_players (id, room_id, user_id, role, joined_at, is_alive, voted_for, last_action_target, is_ready) FROM stdin;
731	192	6	\N	2025-12-23 13:30:49.719076	t	\N	\N	f
732	192	7	\N	2025-12-23 13:31:03.459393	t	\N	\N	f
808	221	6	\N	2025-12-24 12:14:10.627064	t	\N	\N	f
811	221	7	\N	2025-12-24 12:14:23.097549	t	\N	\N	f
812	222	4	sherif	2025-12-24 12:17:24.186916	t	\N	\N	f
813	222	5	citizen	2025-12-24 12:17:30.763655	t	\N	\N	f
814	222	6	citizen	2025-12-24 12:17:36.558143	t	\N	\N	f
816	222	7	mafia	2025-12-24 12:17:55.441536	t	\N	\N	f
\.


--
-- TOC entry 5042 (class 0 OID 16459)
-- Dependencies: 228
-- Data for Name: rooms; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rooms (id, name, password, min_players, max_players, level, roles, created_by, created_at, phase, phase_end_time, game_started, alive_count, mafia_count) FROM stdin;
192	fsd	\N	5	10	1	["doctor", "lover"]	6	2025-12-23 13:30:22.60511	lobby	0	f	0	2
221	Комната	\N	5	10	1	["doctor", "sherif"]	6	2025-12-24 12:13:59.422593	lobby	0	f	0	1
222	Комната	\N	5	10	1	["doctor", "sherif"]	4	2025-12-24 12:17:24.18597	night	0	t	0	1
\.


--
-- TOC entry 5036 (class 0 OID 16410)
-- Dependencies: 222
-- Data for Name: tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tokens (id, user_id, token, expires_at, created_at) FROM stdin;
527	8	d6e945dd120db7696589ba3e70de8589034c1d954bab6df39ae95813320f937d	2025-12-25 21:14:05.738	2025-12-25 20:58:34.597154
\.


--
-- TOC entry 5034 (class 0 OID 16390)
-- Dependencies: 220
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, avatar_id, balance, experience, level, wins, losses, is_banned, created_at, updated_at, password) FROM stdin;
1	Игрок1	2	100	0	1	0	0	f	2025-11-29 14:13:23.567517	2025-11-29 14:13:23.567517	\N
2	Игрок3	1	100	0	1	0	0	f	2025-11-29 14:21:12.761773	2025-11-29 14:21:12.761773	$2b$10$rTNA76wB0gCYQHSsoj1VF.ojRbWJgXtUZpXFAppOJrCyQgfozT/Q6
3	Игрок22	3	100	0	1	0	0	f	2025-11-29 16:29:03.758733	2025-11-29 16:29:03.758733	$2b$10$4QIAl9Lo7cSO7SeD6gXpr.Jb2neolGcOANwddMRlOUxrWjky5OFjS
4	Игрок12	3	100	0	1	0	0	f	2025-12-01 11:50:03.141687	2025-12-01 11:50:03.141687	$2b$10$pop3fg6YhofUYuhwEo5Cf.d62PDhLNkFL7TinZ4l5n1cQXdeh9lPO
5	Игрок13	1	100	0	1	0	0	f	2025-12-01 11:50:57.407764	2025-12-01 11:50:57.407764	$2b$10$E4fhEkkrb2jyEMqzezCKLegn80QOH5FGa0bMpKh8q6qT5ToW9EYuy
6	Игрок14	3	100	0	1	0	0	f	2025-12-01 11:53:37.05318	2025-12-01 11:53:37.05318	$2b$10$S0fGI6HHZLC2g4L17D0QGuG5uFG208fU5uIYgYjQeElQvSeUep1M6
7	Игрок15	1	100	0	1	0	0	f	2025-12-02 17:01:46.967114	2025-12-02 17:01:46.967114	$2b$10$YgFh7ntUHtG2TW.KGp3a6.t78QdyCfFCKJfNkl.QzvOy4II9kI05i
8	Игрок11	0	100	0	1	0	0	f	2025-12-02 19:05:47.32652	2025-12-02 19:05:47.32652	$2b$10$eXjHs2p2j5rbTZ7C326BaOCTj334BWpg/Fd4u56jw3NJnSPLxjzHy
\.


--
-- TOC entry 5056 (class 0 OID 0)
-- Dependencies: 225
-- Name: match_players_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.match_players_id_seq', 1, false);


--
-- TOC entry 5057 (class 0 OID 0)
-- Dependencies: 223
-- Name: matches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.matches_id_seq', 1, false);


--
-- TOC entry 5058 (class 0 OID 0)
-- Dependencies: 229
-- Name: room_players_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.room_players_id_seq', 824, true);


--
-- TOC entry 5059 (class 0 OID 0)
-- Dependencies: 227
-- Name: rooms_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rooms_id_seq', 223, true);


--
-- TOC entry 5060 (class 0 OID 0)
-- Dependencies: 221
-- Name: tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tokens_id_seq', 527, true);


--
-- TOC entry 5061 (class 0 OID 0)
-- Dependencies: 219
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 8, true);


--
-- TOC entry 4876 (class 2606 OID 16445)
-- Name: match_players match_players_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_players
    ADD CONSTRAINT match_players_pkey PRIMARY KEY (id);


--
-- TOC entry 4874 (class 2606 OID 16435)
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- TOC entry 4880 (class 2606 OID 16483)
-- Name: room_players room_players_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.room_players
    ADD CONSTRAINT room_players_pkey PRIMARY KEY (id);


--
-- TOC entry 4878 (class 2606 OID 16474)
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- TOC entry 4870 (class 2606 OID 16418)
-- Name: tokens tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (id);


--
-- TOC entry 4872 (class 2606 OID 16420)
-- Name: tokens tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_token_key UNIQUE (token);


--
-- TOC entry 4866 (class 2606 OID 16406)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4868 (class 2606 OID 16408)
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- TOC entry 4882 (class 2606 OID 16446)
-- Name: match_players match_players_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_players
    ADD CONSTRAINT match_players_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;


--
-- TOC entry 4883 (class 2606 OID 16451)
-- Name: match_players match_players_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_players
    ADD CONSTRAINT match_players_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4884 (class 2606 OID 16484)
-- Name: room_players room_players_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.room_players
    ADD CONSTRAINT room_players_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- TOC entry 4885 (class 2606 OID 16489)
-- Name: room_players room_players_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.room_players
    ADD CONSTRAINT room_players_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4881 (class 2606 OID 16421)
-- Name: tokens tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


-- Completed on 2025-12-26 16:25:29

--
-- PostgreSQL database dump complete
--

\unrestrict icn4EktmQWewdJc3pSnlgSYKOLYyHhI3NrkWCRlionxR9NjZNayllsHIeZmXKgP

