'use client';

import { store } from '@davstack/store';
import { useEffect, useMemo, useRef, useState } from 'react';

export default function Page() {
	return (
		<>
			<div className="w-[300px]">
				<BookInput />
				<ComponentUsingSearchBooks />
			</div>
		</>
	);
}
const books = [
	{ title: 'The Great Gatsby', author: 'F. Scott Fitzgerald' },
	{ title: 'The Catcher in the Rye', author: 'J.D. Salinger' },
	{ title: 'To Kill a Mockingbird', author: 'Harper Lee' },
	{ title: 'The Lord of the Rings', author: 'J.R.R. Tolkien' },
];

const altStore = store({
	searchTerm: '',
}).extend((store) => ({
	useFilteredBooks: () => {
		const searchTerm = store.searchTerm.use();
		return books.filter((book) => {
			if (!searchTerm) return true;
			return book.title.toLowerCase().includes(searchTerm.toLowerCase());
		});
	},
}));

const ComponentUsingSearchBooks = () => {
	const filteredBooks = altStore.useFilteredBooks();
	return (
		<>
			<h2>Books:</h2>
			<ul className="h-[300px]">
				{filteredBooks.map((book, index) => (
					<li key={index}>
						{book.title} by {book.author}
					</li>
				))}
			</ul>
		</>
	);
};

function BookInput() {
	const searchTerm = altStore.searchTerm.use();
	return (
		<input
			type="text"
			value={searchTerm}
			onChange={(e) => altStore.searchTerm.set(e.target.value)}
			placeholder="Search for a book..."
			className="w-full p-2 border border-gray-300 rounded-md"
		/>
	);
}
