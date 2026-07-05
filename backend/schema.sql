-- SQL Database Schema for Starlit Shield (Supabase / Postgres)
-- Migration reference:
-- ALTER TABLE public.users ADD CONSTRAINT unique_deposit_memo UNIQUE (deposit_memo);

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(30) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    email VARCHAR(255) UNIQUE NOT NULL,
    stellar_address VARCHAR(56),
    identity_commitment TEXT NOT NULL,
    public_encryption_key TEXT NOT NULL,
    avatar_url TEXT,
    deposit_memo BIGINT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT username_length CHECK (char_length(username) >= 3)
);

-- Create Payment Links Table
CREATE TABLE IF NOT EXISTS public.payment_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    amount NUMERIC(20, 7) NOT NULL,
    asset VARCHAR(10) DEFAULT 'USDC' NOT NULL,
    commitment TEXT UNIQUE NOT NULL,
    description TEXT, -- Stored encrypted in the frontend (ciphertext)
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'claimed')) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for performance lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_payment_links_commitment ON public.payment_links(commitment);

-- Set up Row Level Security (RLS) if required
-- For simplicity in this real app backend-to-database connection, we bypass RLS or allow service role access.
-- If client-side direct access is desired, RLS policies can be defined here.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

-- Simple public policies allowing read/write operations (since backend will authenticate via API keys)
CREATE POLICY "Allow public read access to profiles" ON public.users
    FOR SELECT USING (true);

CREATE POLICY "Allow service insert/update profiles" ON public.users
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public select payment links" ON public.payment_links
    FOR SELECT USING (true);

CREATE POLICY "Allow service insert/update payment links" ON public.payment_links
    FOR ALL USING (true) WITH CHECK (true);

-- Create Encrypted Transactions Table
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    encrypted_payload TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS and create security policies
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select transactions" ON public.transactions
    FOR SELECT USING (true);

CREATE POLICY "Allow service insert transactions" ON public.transactions
    FOR INSERT WITH CHECK (true);

