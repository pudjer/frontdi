import {
  fetchUserGeo,
  fetchUserCompany,
  fetchUserAddress,
  fetchUserPosts,
  fetchPostComments,
} from './jsonplaceholderApi'; // путь к вашему файлу с кодом

export async function examples() {
  // идентификаторы для примера
  const userId = 1;
  const postId = 1;

  try {
    // 1. Получить географические координаты пользователя
    const geo = await fetchUserGeo(userId);
    console.log('📍 Координаты пользователя:', geo);

    // 2. Получить информацию о компании
    const company = await fetchUserCompany(userId);
    console.log('🏢 Компания:', company);

    // 3. Получить полный адрес
    const address = await fetchUserAddress(userId);
    console.log('🏠 Адрес:', address);

    // 4. Получить только имя пользователя
    // 5. Получить все посты пользователя
    const posts = await fetchUserPosts(userId);
    console.log(`📝 Количество постов: ${posts.length}`);
    console.log('   Заголовок первого поста:', posts[0]?.title);

    // 6. Получить комментарии к конкретному посту
    const comments = await fetchPostComments(postId);
    console.log(`💬 Комментариев к посту #${postId}: ${comments.length}`);
    console.log('   Первый комментарий:', comments[0]?.body);
  } catch (error) {
    console.error('❌ Произошла ошибка:', error);
  }
}
