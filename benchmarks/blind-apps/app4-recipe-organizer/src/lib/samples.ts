export interface SampleRecipe {
	name: string;
	ingredients: { quantity: string; name: string }[];
	instructions: string[];
}

export const sampleRecipes: SampleRecipe[] = [
	{
		name: 'Fluffy Weekend Pancakes',
		ingredients: [
			{ quantity: '2 cups', name: 'all-purpose flour' },
			{ quantity: '2 tablespoons', name: 'sugar' },
			{ quantity: '2 teaspoons', name: 'baking powder' },
			{ quantity: '1/2 teaspoon', name: 'fine salt' },
			{ quantity: '2', name: 'large eggs' },
			{ quantity: '1 3/4 cups', name: 'whole milk' },
			{ quantity: '1/4 cup', name: 'melted butter' },
			{ quantity: '1 teaspoon', name: 'vanilla extract' }
		],
		instructions: [
			'Whisk the flour, sugar, baking powder and salt together in a large bowl.',
			'In a separate bowl, beat the eggs, then whisk in the milk, melted butter and vanilla.',
			'Pour the wet ingredients into the dry and fold until just combined — a few lumps are perfectly fine.',
			'Let the batter rest for 5 minutes while a lightly greased skillet heats over medium.',
			'Pour 1/4-cup rounds onto the skillet and cook until the bubbles on top pop, about 2 minutes.',
			'Flip and cook 1–2 minutes more, until deeply golden.',
			'Stack high, drown in maple syrup, and serve.'
		]
	},
	{
		name: 'Roasted Tomato & Basil Soup',
		ingredients: [
			{ quantity: '2 lb', name: 'ripe tomatoes' },
			{ quantity: '3 tablespoons', name: 'olive oil' },
			{ quantity: '1', name: 'yellow onion' },
			{ quantity: '4 cloves', name: 'garlic' },
			{ quantity: '1 can', name: 'crushed tomatoes (28 oz)' },
			{ quantity: '2 cups', name: 'vegetable broth' },
			{ quantity: '1/2 cup', name: 'heavy cream' },
			{ quantity: '1/4 cup', name: 'fresh basil' },
			{ quantity: '1 teaspoon', name: 'kosher salt' },
			{ quantity: '', name: 'black pepper' }
		],
		instructions: [
			'Preheat the oven to 400°F / 200°C.',
			'Halve the tomatoes and toss them with 2 tablespoons of the olive oil, the salt and a good grind of pepper.',
			'Roast on a sheet pan for 25 minutes, until blistered and jammy.',
			'In a pot over medium heat, sauté the diced onion in the remaining oil until translucent, about 5 minutes.',
			'Add the garlic and cook 1 minute more.',
			'Add the roasted tomatoes with all their juices, the crushed tomatoes and the broth; simmer for 10 minutes.',
			'Blend until smooth — an immersion blender makes this easy — then stir in the cream.',
			'Tear in the basil, season to taste, and serve with grilled cheese, obviously.'
		]
	},
	{
		name: 'Garlic Butter Shrimp Pasta',
		ingredients: [
			{ quantity: '12 oz', name: 'spaghetti' },
			{ quantity: '1 lb', name: 'shrimp, peeled and deveined' },
			{ quantity: '4 tablespoons', name: 'unsalted butter' },
			{ quantity: '4 cloves', name: 'garlic' },
			{ quantity: '1', name: 'lemon' },
			{ quantity: '1/4 cup', name: 'fresh parsley' },
			{ quantity: '1/2 teaspoon', name: 'chili flakes' },
			{ quantity: '1 teaspoon', name: 'kosher salt' },
			{ quantity: '', name: 'black pepper' }
		],
		instructions: [
			'Bring a large pot of well-salted water to a boil and cook the spaghetti until al dente.',
			'Before draining, reserve 1/2 cup of the starchy pasta water.',
			'Meanwhile, pat the shrimp dry and season with salt, pepper and the chili flakes.',
			'Melt the butter in a large skillet over medium heat, add the sliced garlic and cook until fragrant, about 1 minute.',
			'Add the shrimp and cook 1–2 minutes per side, until just pink and opaque.',
			'Toss in the drained pasta along with the lemon juice and half the parsley, loosening with splashes of pasta water as needed.',
			'Serve immediately, topped with the remaining parsley and extra chili flakes.'
		]
	},
	{
		name: 'Classic Chocolate Chip Cookies',
		ingredients: [
			{ quantity: '2 1/4 cups', name: 'all-purpose flour' },
			{ quantity: '1 teaspoon', name: 'baking soda' },
			{ quantity: '1 teaspoon', name: 'fine salt' },
			{ quantity: '1 cup', name: 'unsalted butter' },
			{ quantity: '3/4 cup', name: 'granulated sugar' },
			{ quantity: '3/4 cup', name: 'brown sugar' },
			{ quantity: '2', name: 'eggs' },
			{ quantity: '2 cups', name: 'chocolate chips' },
			{ quantity: '2 teaspoons', name: 'vanilla extract' }
		],
		instructions: [
			'Preheat the oven to 375°F / 190°C and line two sheet pans with parchment.',
			'Cream the softened butter with both sugars until light and fluffy.',
			'Beat in the eggs one at a time, then the vanilla.',
			'Whisk the flour, baking soda and salt together, then fold into the butter mixture.',
			'Fold in the chocolate chips — and eat a spoonful of dough, it is tradition.',
			'Scoop golf-ball-sized rounds onto the pans, 2 inches apart.',
			'Bake for 10–12 minutes, until the edges are set but the centers still look slightly underdone.',
			'Cool on the pan for 5 minutes before moving them — this is the difference between good and legendary.'
		]
	}
];
