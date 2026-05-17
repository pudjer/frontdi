// Типы
export interface Geo {
  lat: string;
  lng: string;
}

export interface Address {
  street: string;
  suite: string;
  city: string;
  zipcode: string;
  geo: Geo;
}

export interface Company {
  name: string;
  catchPhrase: string;
  bs: string;
}

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  address: Address;
  phone: string;
  website: string;
  company: Company;
}

export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

export interface Comment {
  postId: number;
  id: number;
  name: string;
  email: string;
  body: string;
}

// Универсальный fetch
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}


export async function getUser(userId: number): Promise<User> {
  const user = await fetchJson<User>(`https://jsonplaceholder.typicode.com/users/${userId}`);
  return user;
}

export async function getPosts(userId: number): Promise<Post[]> {
  const posts = await fetchJson<Post[]>(`https://jsonplaceholder.typicode.com/posts?userId=${userId}`);
  return posts;
}

export async function getComments(postId: number): Promise<Comment[]> {
  const comments = await fetchJson<Comment[]>(`https://jsonplaceholder.typicode.com/comments?postId=${postId}`);
  return comments;
}

// ========== Атомарные fetch-функции ==========

// --- Пользователь (части) ---
export async function fetchUserGeo(userId: number): Promise<Geo> {
  const address = await fetchUserAddress(userId);
  return address.geo;
}

export async function fetchUserCompany(userId: number): Promise<Company> {
  const user = await getUser(userId);
  return user.company;
}

export async function fetchUserAddress(userId: number): Promise<Address> {
  const user = await getUser(userId);
  return user.address;
}

// --- Посты (массивы) ---
/**
 * Все посты пользователя.
 */
export async function fetchUserPosts(userId: number): Promise<Post[]> {
  return getPosts(userId);
}

// --- Комментарии (массивы) ---
/**
 * Комментарии к одному посту.
 */
export async function fetchPostComments(postId: number): Promise<Comment[]> {
  return getComments(postId);
}

